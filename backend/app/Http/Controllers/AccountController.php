<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Profile, addresses, notifications. Plain table access — RLS does the guarding. */
class AccountController extends Controller
{
    public function me(): Response
    {
        return $this->rpc('account_summary');
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'full_name' => 'sometimes|nullable|string|max:120',
            'username' => ['sometimes', 'nullable', 'regex:/^[a-zA-Z0-9_]{3,30}$/'],
            'phone' => ['sometimes', 'nullable', 'regex:/^\+?[0-9 \-]{6,20}$/'],
            'avatar_url' => 'sometimes|nullable|url|max:500',
        ]);
        abort_if(empty($data), 422, 'Nothing to update');

        $sets = implode(', ', array_map(fn ($col) => "{$col} = ?", array_keys($data)));
        $row = $this->pg->selectOne(
            "update public.profiles set {$sets} where id = auth.uid()
             returning to_jsonb(profiles.*) as profile",
            array_values($data)
        );

        return response()->json(json_decode($row->profile, true));
    }

    // ------------------------------------------------------------ addresses
    private const ADDRESS_RULES = [
        'label' => 'sometimes|string|max:40',
        'recipient' => 'required|string|min:2|max:120',
        'phone' => ['required', 'regex:/^\+?[0-9 \-]{6,20}$/'],
        'line1' => 'required|string|min:3|max:200',
        'line2' => 'nullable|string|max:200',
        'area' => 'nullable|string|max:80',
        'city' => 'required|string|max:60',
        'postal_code' => 'nullable|string|max:12',
        'is_default' => 'sometimes|boolean',
    ];

    public function addresses(): Response
    {
        $row = $this->pg->selectOne(
            "select coalesce(jsonb_agg(to_jsonb(a) order by a.is_default desc, a.created_at), '[]') as list
               from public.addresses a where a.user_id = auth.uid()"
        );

        return $this->raw($row->list);
    }

    public function storeAddress(Request $request): Response
    {
        $data = $request->validate(self::ADDRESS_RULES);
        $data['is_default'] = (bool) ($data['is_default'] ?? false);
        $cols = array_keys($data);

        $row = $this->pg->selectOne(
            'insert into public.addresses (user_id, '.implode(', ', $cols).')
             values (auth.uid(), '.implode(', ', array_fill(0, count($cols), '?')).')
             returning to_jsonb(addresses.*) as address',
            array_map(fn ($v) => is_bool($v) ? ($v ? 'true' : 'false') : $v, array_values($data))
        );

        return $this->raw($row->address, 201);
    }

    public function updateAddress(Request $request, int $id): Response
    {
        $rules = array_map(fn ($r) => is_array($r) ? array_merge(['sometimes'], $r) : 'sometimes|'.$r, self::ADDRESS_RULES);
        $data = $request->validate($rules);
        abort_if(empty($data), 422, 'Nothing to update');

        $sets = implode(', ', array_map(fn ($col) => "{$col} = ?", array_keys($data)));
        $row = $this->pg->selectOne(
            "update public.addresses set {$sets} where id = ? returning to_jsonb(addresses.*) as address",
            [...array_map(fn ($v) => is_bool($v) ? ($v ? 'true' : 'false') : $v, array_values($data)), $id]
        );
        abort_unless($row, 404, 'Address not found');

        return $this->raw($row->address);
    }

    public function destroyAddress(int $id): Response
    {
        $row = $this->pg->selectOne('delete from public.addresses where id = ? returning id', [$id]);
        abort_unless($row, 404, 'Address not found');

        return response()->noContent();
    }

    // -------------------------------------------------------- notifications
    public function notifications(Request $request): Response
    {
        $row = $this->pg->selectOne(
            "select jsonb_build_object(
                'unread', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
                'items', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
                                     from (select * from public.notifications
                                            where user_id = auth.uid() and (? = false or read_at is null)
                                            order by created_at desc limit 40) n), '[]')) as result",
            [$request->boolean('unread') ? 'true' : 'false']
        );

        return $this->raw($row->result);
    }

    public function markRead(Request $request): JsonResponse
    {
        $data = $request->validate(['ids' => 'nullable|array', 'ids.*' => 'integer']);
        $ids = isset($data['ids']) ? \App\Support\Db\PgValue::array($data['ids'], 'bigint') : null;

        return response()->json(['marked' => $this->pg->call('mark_notifications_read', ['p_ids' => $ids])]);
    }
}
