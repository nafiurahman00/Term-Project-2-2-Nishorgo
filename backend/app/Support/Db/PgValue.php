<?php

namespace App\Support\Db;

use InvalidArgumentException;

/**
 * A typed function argument. Plain PHP scalars are inferred; use the static
 * constructors when Postgres needs an explicit type (enums, arrays, jsonb).
 */
final class PgValue
{
    private function __construct(public readonly mixed $value, public readonly string $type)
    {
        if (! preg_match('/^[a-z_][a-z0-9_.]*(\[\])?$/', $type)) {
            throw new InvalidArgumentException("Invalid Postgres type: {$type}");
        }
    }

    public static function of(mixed $value, string $type): self
    {
        return new self($value, $type);
    }

    public static function json(mixed $value): self
    {
        return new self($value, 'jsonb');
    }

    /** @param array<int, scalar>|null $values */
    public static function array(?array $values, string $elementType): self
    {
        return new self($values, $elementType.'[]');
    }

    /** @return array{0: string, 1: mixed} placeholder SQL + binding */
    public static function compile(mixed $value): array
    {
        if ($value instanceof self) {
            if ($value->value === null) {
                return ["?::{$value->type}", null];
            }
            if ($value->type === 'jsonb') {
                return ['?::jsonb', json_encode($value->value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)];
            }
            if (str_ends_with($value->type, '[]')) {
                return ["?::{$value->type}", self::arrayLiteral((array) $value->value)];
            }

            return ["?::{$value->type}", self::scalar($value->value)];
        }

        return match (true) {
            $value === null => ['?', null],
            is_bool($value) => ['?::boolean', $value ? 'true' : 'false'],
            // Numbers stay untyped ("unknown") so Postgres resolves them to the
            // parameter's declared type (integer, smallint, bigint, numeric).
            is_int($value), is_float($value) => ['?', (string) $value],
            is_array($value) => ['?::jsonb', json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)],
            default => ['?', (string) $value],
        };
    }

    private static function scalar(mixed $value): mixed
    {
        return is_bool($value) ? ($value ? 'true' : 'false') : $value;
    }

    /** Builds a Postgres array literal: {"a","b \"quoted\""} */
    private static function arrayLiteral(array $values): string
    {
        $items = array_map(function ($v) {
            if ($v === null) {
                return 'NULL';
            }
            $v = is_bool($v) ? ($v ? 'true' : 'false') : (string) $v;

            return '"'.addcslashes($v, '"\\').'"';
        }, array_values($values));

        return '{'.implode(',', $items).'}';
    }
}
