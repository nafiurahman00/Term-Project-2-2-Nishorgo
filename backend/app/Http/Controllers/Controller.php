<?php

namespace App\Http\Controllers;

use App\Support\Db\Pg;
use Illuminate\Http\Response;

abstract class Controller
{
    public function __construct(protected readonly Pg $pg)
    {
    }

    /** Stream JSON produced by Postgres straight to the client. */
    protected function raw(?string $json, int $status = 200): Response
    {
        return response($json ?? 'null', $status, ['Content-Type' => 'application/json']);
    }

    protected function rpc(string $function, array $args = [], int $status = 200): Response
    {
        return $this->raw($this->pg->callRaw($function, $args), $status);
    }

    protected function page(int $perPage = 24): array
    {
        $perPage = max(1, min((int) request('per_page', $perPage), 100));
        $page = max(1, (int) request('page', 1));

        return [$perPage, ($page - 1) * $perPage];
    }
}
