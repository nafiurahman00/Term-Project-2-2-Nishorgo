<?php

namespace App\Support\Db;

use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

/**
 * Translates Postgres errors raised by our functions/triggers/constraints into
 * clean HTTP responses. Business rules raise SQLSTATE P0001 with a HINT that
 * becomes the machine-readable `code` (e.g. out_of_stock, coupon_expired).
 */
class PgErrorMapper
{
    public static function toResponse(QueryException $e): ?JsonResponse
    {
        $state = $e->errorInfo[0] ?? (string) $e->getCode();
        $detail = (string) ($e->errorInfo[2] ?? $e->getPrevious()?->getMessage() ?? '');

        [$message, $hint] = self::parse($detail);

        [$status, $fallbackCode] = match ($state) {
            'P0001' => [422, 'business_rule'],
            'P0002' => [404, 'not_found'],
            '42501' => [$hint === 'unauthenticated' ? 401 : 403, 'forbidden'],
            '23505' => [409, 'conflict'],
            '23503' => [422, 'invalid_reference'],
            '23514', '23502', '22P02', '22023', '22003', '22001' => [422, 'invalid_input'],
            '40001', '40P01' => [409, 'retry'],
            default => [null, null],
        };

        if ($status === null) {
            return null;   // unknown error → let Laravel report it as a 500
        }

        // Constraint messages are developer-facing; keep them generic for users.
        if (in_array($state, ['23505', '23503', '23514', '23502', '22P02', '22023', '22003', '22001'], true)) {
            $message = match ($state) {
                '23505' => 'That already exists',
                '23503' => 'Something you referenced no longer exists',
                default => 'Some of the details you entered aren\'t valid',
            };
        }

        return response()->json([
            'message' => $message ?: 'Request failed',
            'code' => $hint ?: $fallbackCode,
        ], $status);
    }

    /** @return array{0: string, 1: ?string} */
    private static function parse(string $detail): array
    {
        $message = preg_match('/ERROR:\s+(.+?)(?:\n|$)/', $detail, $m) ? trim($m[1]) : trim(strtok($detail, "\n") ?: '');
        // Only our own snake_case hints are codes; Postgres' prose hints are ignored.
        $hint = preg_match('/HINT:\s+([a-z][a-z0-9_]*)\s*(?:\n|$)/', $detail, $h) ? $h[1] : null;

        return [$message, $hint];
    }
}
