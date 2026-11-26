<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Reviews, My Garden and chat. New chat messages are written through the
 * API; clients receive them live via Supabase Realtime (postgres_changes),
 * which applies the same RLS policies.
 */
class CommunityController extends Controller
{
    // ------------------------------------------------------------- reviews
    public function review(Request $request, int $productId): Response
    {
        $data = $request->validate([
            'rating' => 'required|integer|min:1|max:5',
            'title' => 'nullable|string|max:120',
            'body' => 'nullable|string|max:4000',
            'photos' => 'nullable|array|max:4', 'photos.*' => 'url|max:500',
        ]);

        return $this->rpc('submit_review', [
            'p_product_id' => $productId,
            'p_rating' => (int) $data['rating'],
            'p_title' => $data['title'] ?? null,
            'p_body' => $data['body'] ?? null,
            'p_photos' => \App\Support\Db\PgValue::array($data['photos'] ?? [], 'text'),
        ], 201);
    }

    public function vote(int $reviewId): JsonResponse
    {
        return response()->json(['voted' => $this->pg->call('toggle_review_vote', ['p_review_id' => $reviewId])]);
    }

    // -------------------------------------------------------------- garden
    private const PLANT_FIELDS = ['nickname', 'species', 'location', 'photo_url', 'light',
        'water_every_days', 'fertilize_every_days', 'is_archived'];

    public function garden(): Response
    {
        return $this->rpc('garden_overview');
    }

    public function addPlant(Request $request): Response
    {
        $data = $request->validate([
            'nickname' => 'required|string|max:60',
            'species' => 'nullable|string|max:120',
            'location' => 'nullable|string|max:60',
            'photo_url' => 'nullable|url|max:500',
            'light' => 'nullable|in:low,medium,bright_indirect,full_sun',
            'water_every_days' => 'required|integer|min:1|max:60',
            'fertilize_every_days' => 'nullable|integer|min:7|max:365',
        ]);
        $cols = array_keys($data);
        $row = $this->pg->selectOne(
            'insert into public.garden_plants (user_id, '.implode(', ', $cols).')
             values (auth.uid(), '.implode(', ', array_map(fn ($c) => $c === 'light' ? '?::public.light_level' : '?', $cols)).')
             returning id',
            array_values($data)
        );

        return $this->rpc('garden_overview', [], 201);
    }

    public function updatePlant(Request $request, int $id): Response
    {
        $data = $request->validate([
            'nickname' => 'sometimes|string|max:60',
            'location' => 'sometimes|nullable|string|max:60',
            'photo_url' => 'sometimes|nullable|url|max:500',
            'light' => 'sometimes|nullable|in:low,medium,bright_indirect,full_sun',
            'water_every_days' => 'sometimes|integer|min:1|max:60',
            'fertilize_every_days' => 'sometimes|nullable|integer|min:7|max:365',
            'is_archived' => 'sometimes|boolean',
        ]);
        $data = array_intersect_key($data, array_flip(self::PLANT_FIELDS));
        abort_if(empty($data), 422, 'Nothing to update');

        $sets = implode(', ', array_map(
            fn ($c) => $c === 'light' ? "{$c} = ?::public.light_level" : ($c === 'is_archived' ? "{$c} = ?::boolean" : "{$c} = ?"),
            array_keys($data)
        ));
        $values = array_map(fn ($v) => is_bool($v) ? ($v ? 'true' : 'false') : $v, array_values($data));
        $row = $this->pg->selectOne("update public.garden_plants set {$sets} where id = ? returning id", [...$values, $id]);
        abort_unless($row, 404, 'Plant not found');

        return $this->rpc('garden_overview');
    }

    public function removePlant(int $id): Response
    {
        $row = $this->pg->selectOne('delete from public.garden_plants where id = ? returning id', [$id]);
        abort_unless($row, 404, 'Plant not found');

        return response()->noContent();
    }

    public function logCare(Request $request, int $id): Response
    {
        $data = $request->validate([
            'task' => 'required|in:water,fertilize,mist,prune,repot',
            'note' => 'nullable|string|max:280',
        ]);

        return $this->rpc('log_care', [
            'p_plant_id' => $id,
            'p_task' => \App\Support\Db\PgValue::of($data['task'], 'public.care_task'),
            'p_note' => $data['note'] ?? null,
        ]);
    }

    // ---------------------------------------------------------------- chat
    public function rooms(): Response
    {
        return $this->rpc('chat_rooms_for_me');
    }

    public function messages(Request $request, string $roomId): Response
    {
        $request->validate(['before' => 'nullable|integer']);

        return $this->rpc('chat_history', [
            'p_room_id' => $roomId,
            'p_before_id' => $request->filled('before') ? (int) $request->input('before') : null,
            'p_limit' => 40,
        ]);
    }

    public function send(Request $request, string $roomId): Response
    {
        $data = $request->validate([
            'body' => 'nullable|required_without:image_url|string|max:2000',
            'image_url' => 'nullable|url|max:500',
            'reply_to' => 'nullable|integer',
        ]);

        return $this->rpc('send_chat_message', [
            'p_room_id' => $roomId,
            'p_body' => $data['body'] ?? null,
            'p_image_url' => $data['image_url'] ?? null,
            'p_reply_to' => isset($data['reply_to']) ? (int) $data['reply_to'] : null,
        ], 201);
    }

    public function editMessage(Request $request, int $id): Response
    {
        $data = $request->validate(['body' => 'required|string|max:2000']);

        return $this->rpc('edit_chat_message', ['p_message_id' => $id, 'p_body' => $data['body']]);
    }

    public function deleteMessage(int $id): Response
    {
        $this->pg->call('delete_chat_message', ['p_message_id' => $id]);

        return response()->noContent();
    }

    public function react(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['emoji' => 'required|string|max:8']);

        return response()->json([
            'reacted' => $this->pg->call('toggle_chat_reaction', ['p_message_id' => $id, 'p_emoji' => $data['emoji']]),
        ]);
    }

    public function markRoomRead(string $roomId): Response
    {
        $this->pg->call('mark_room_read', ['p_room_id' => $roomId]);

        return response()->noContent();
    }

    public function openSupport(Request $request): Response
    {
        $data = $request->validate([
            'order_id' => 'nullable|uuid',
            'message' => 'nullable|string|max:2000',
        ]);

        return $this->rpc('open_support_chat', [
            'p_order_id' => $data['order_id'] ?? null,
            'p_message' => $data['message'] ?? null,
        ]);
    }

    public function resolveSupport(string $roomId): Response
    {
        $this->pg->call('resolve_support_chat', ['p_room_id' => $roomId]);

        return response()->noContent();
    }
}
