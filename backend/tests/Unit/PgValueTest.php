<?php

namespace Tests\Unit;

use App\Support\Db\PgErrorMapper;
use App\Support\Db\PgValue;
use Illuminate\Database\QueryException;
use InvalidArgumentException;
use PDOException;
use Tests\TestCase;

class PgValueTest extends TestCase
{
    public function test_scalars_compile_to_untyped_or_boolean_placeholders(): void
    {
        $this->assertSame(['?', null], PgValue::compile(null));
        $this->assertSame(['?::boolean', 'true'], PgValue::compile(true));
        $this->assertSame(['?', '42'], PgValue::compile(42));
        $this->assertSame(['?', 'hello'], PgValue::compile('hello'));
    }

    public function test_arrays_become_escaped_postgres_literals(): void
    {
        [$sql, $binding] = PgValue::compile(PgValue::array(['a', 'b "quoted"', 'back\\slash'], 'text'));
        $this->assertSame('?::text[]', $sql);
        $this->assertSame('{"a","b \"quoted\"","back\\\\slash"}', $binding);
    }

    public function test_enum_and_json_values_are_cast(): void
    {
        $this->assertSame(['?::public.order_status', 'paid'], PgValue::compile(PgValue::of('paid', 'public.order_status')));
        $this->assertSame(['?::jsonb', '{"name":"Rose"}'], PgValue::compile(PgValue::json(['name' => 'Rose'])));
    }

    public function test_type_names_are_validated(): void
    {
        $this->expectException(InvalidArgumentException::class);
        PgValue::of('x', 'text; drop table orders');
    }

    public function test_business_errors_map_to_422_with_hint_code(): void
    {
        $response = PgErrorMapper::toResponse($this->queryException('P0001', "ERROR:  Only 3 of \"Rose\" left\nHINT:  out_of_stock\nCONTEXT:  PL/pgSQL"));
        $this->assertSame(422, $response->status());
        $this->assertSame(['message' => 'Only 3 of "Rose" left', 'code' => 'out_of_stock'], $response->getData(true));
    }

    public function test_permission_errors_ignore_prose_hints(): void
    {
        $response = PgErrorMapper::toResponse($this->queryException('42501', "ERROR:  permission denied for table orders\nHINT:  Grant the required privileges"));
        $this->assertSame(403, $response->status());
        $this->assertSame('forbidden', $response->getData(true)['code']);
    }

    public function test_unauthenticated_hint_maps_to_401(): void
    {
        $response = PgErrorMapper::toResponse($this->queryException('42501', "ERROR:  Please sign in first\nHINT:  unauthenticated"));
        $this->assertSame(401, $response->status());
    }

    public function test_unknown_errors_are_left_for_laravel(): void
    {
        $this->assertNull(PgErrorMapper::toResponse($this->queryException('XX000', 'ERROR:  internal')));
    }

    private function queryException(string $state, string $detail): QueryException
    {
        $pdo = new PDOException($detail);
        $pdo->errorInfo = [$state, 7, $detail];

        return new QueryException('pgsql', 'select 1', [], $pdo);
    }
}
