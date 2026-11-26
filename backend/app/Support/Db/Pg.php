<?php

namespace App\Support\Db;

use Closure;
use Illuminate\Database\ConnectionInterface;
use InvalidArgumentException;

/**
 * Gateway to the Supabase Postgres database.
 *
 * Every call runs inside a transaction that impersonates the end user the same
 * way PostgREST does:
 *
 *     set local role authenticated;                       -- or anon
 *     select set_config('request.jwt.claims', '{...}', true);
 *
 * so auth.uid(), Row Level Security and every SECURITY INVOKER function behave
 * exactly as they would for a direct Supabase client. Business logic lives in
 * Postgres functions; PHP stays a thin, typed transport layer.
 *
 * `system()` runs privileged work (Stripe webhooks, refunds) as the connection
 * owner, without impersonation.
 */
class Pg
{
    private ?array $claims = null;

    private bool $system = false;

    private bool $inScope = false;

    public function __construct(private readonly ConnectionInterface $db)
    {
    }

    /** Bind the current request's verified JWT claims (null = anonymous). */
    public function actingAs(?array $claims): static
    {
        $this->claims = $claims;

        return $this;
    }

    public function userId(): ?string
    {
        return $this->claims['sub'] ?? null;
    }

    public function claims(): ?array
    {
        return $this->claims;
    }

    /** Call a database function that returns json/jsonb and decode it. */
    public function call(string $function, array $args = []): mixed
    {
        $raw = $this->callRaw($function, $args);

        return $raw === null ? null : json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * Call a database function and return its result as a raw string. For
     * jsonb functions this is already-serialised JSON we can stream straight
     * to the client without a decode/encode round trip.
     */
    public function callRaw(string $function, array $args = []): ?string
    {
        [$sql, $bindings] = $this->compileCall($function, $args);

        return $this->scope(function () use ($sql, $bindings) {
            $value = $this->db->selectOne($sql, $bindings)?->result;

            return match (true) {
                $value === null => null,
                is_bool($value) => $value ? 'true' : 'false',   // pdo_pgsql returns PHP bools
                default => (string) $value,
            };
        });
    }

    /** @return array<int, object> */
    public function select(string $sql, array $bindings = []): array
    {
        return $this->scope(fn () => $this->db->select($sql, $bindings));
    }

    public function selectOne(string $sql, array $bindings = []): ?object
    {
        return $this->scope(fn () => $this->db->selectOne($sql, $bindings));
    }

    /**
     * Group several calls into one transaction / one identity switch.
     */
    public function scope(Closure $work): mixed
    {
        if ($this->inScope) {
            return $work();
        }

        return $this->db->transaction(function () use ($work) {
            $this->applyIdentity();
            $this->inScope = true;
            try {
                return $work();
            } finally {
                $this->inScope = false;
            }
        });
    }

    /** Run privileged work as the database owner (bypasses RLS). */
    public function system(Closure $work): mixed
    {
        if ($this->inScope) {
            throw new \LogicException('Cannot escalate to system inside a user-scoped transaction');
        }

        $previous = $this->system;
        $this->system = true;
        try {
            return $this->scope($work);
        } finally {
            $this->system = $previous;
        }
    }

    private function applyIdentity(): void
    {
        if ($this->system) {
            return;
        }

        $role = $this->claims ? 'authenticated' : 'anon';
        $claims = $this->claims ?? ['role' => 'anon'];

        $this->db->select(
            "select set_config('request.jwt.claims', ?, true),
                    set_config('request.jwt.claim.sub', ?, true),
                    set_config('request.jwt.claim.role', ?, true)",
            [json_encode($claims), (string) ($claims['sub'] ?? ''), $role]
        );
        // $role comes from a fixed whitelist above — never from input.
        $this->db->statement("set local role {$role}");
    }

    /**
     * Compile `select schema.fn(p_a => ?, p_b => ?::type) as result`, using
     * named-argument notation so argument order never matters.
     *
     * @return array{0: string, 1: array<int, mixed>}
     */
    private function compileCall(string $function, array $args): array
    {
        if (! preg_match('/^(public|private)\.[a-z_][a-z0-9_]*$/', $function)) {
            $function = 'public.'.$function;
        }
        if (! preg_match('/^(public|private)\.[a-z_][a-z0-9_]*$/', $function)) {
            throw new InvalidArgumentException("Invalid function name: {$function}");
        }

        $parts = [];
        $bindings = [];
        foreach ($args as $name => $value) {
            if (! preg_match('/^p_[a-z0-9_]+$/', $name)) {
                throw new InvalidArgumentException("Invalid argument name: {$name}");
            }
            [$placeholder, $binding] = PgValue::compile($value);
            $parts[] = "{$name} => {$placeholder}";
            $bindings[] = $binding;
        }

        return ["select {$function}(".implode(', ', $parts).') as result', $bindings];
    }
}
