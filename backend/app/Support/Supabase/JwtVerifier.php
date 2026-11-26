<?php

namespace App\Support\Supabase;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

/**
 * Verifies Supabase Auth access tokens.
 *
 * - Asymmetric (ES256/RS256) tokens are checked against the project's JWKS,
 *   which is cached and refreshed once when an unknown key id appears
 *   (Supabase key rotation).
 * - Legacy HS256 tokens are checked against SUPABASE_JWT_SECRET.
 */
class JwtVerifier
{
    private const CACHE_KEY = 'supabase.jwks';

    public function __construct(private readonly array $config)
    {
        JWT::$leeway = 30;
    }

    /** @return array<string, mixed> the verified claims */
    public function verify(string $token): array
    {
        $alg = $this->peekHeader($token)['alg'] ?? null;

        try {
            $decoded = match ($alg) {
                'HS256' => JWT::decode($token, new Key($this->requireSecret(), 'HS256')),
                'ES256', 'RS256' => $this->decodeWithJwks($token),
                default => throw new InvalidTokenException('Unsupported token algorithm'),
            };
        } catch (InvalidTokenException $e) {
            throw $e;
        } catch (Throwable $e) {
            throw new InvalidTokenException('Invalid or expired session', previous: $e);
        }

        $claims = json_decode(json_encode($decoded), true);

        $aud = (array) ($claims['aud'] ?? []);
        if (! in_array($this->config['jwt_audience'], $aud, true)) {
            throw new InvalidTokenException('Token audience mismatch');
        }
        if (empty($claims['sub'])) {
            throw new InvalidTokenException('Token has no subject');
        }

        return $claims;
    }

    private function decodeWithJwks(string $token): object
    {
        $kid = $this->peekHeader($token)['kid'] ?? null;
        $keys = $this->keys();

        if ($kid !== null && ! isset($keys[$kid])) {
            $keys = $this->keys(refresh: true);   // key rotated since we cached
        }

        return JWT::decode($token, $keys);
    }

    /** @return array<string, Key> */
    private function keys(bool $refresh = false): array
    {
        if ($refresh) {
            Cache::forget(self::CACHE_KEY);
        }

        $jwks = Cache::remember(self::CACHE_KEY, $this->config['jwks_cache_seconds'], function () {
            $url = $this->config['jwks_url'] ?: $this->config['url'].'/auth/v1/.well-known/jwks.json';
            $response = Http::timeout(5)->acceptJson()->get($url);
            if (! $response->ok() || empty($response->json('keys'))) {
                throw new RuntimeException("Could not load JWKS from {$url}");
            }

            return $response->json();
        });

        return JWK::parseKeySet($jwks);
    }

    private function requireSecret(): string
    {
        $secret = $this->config['jwt_secret'] ?? null;
        if (! $secret) {
            throw new InvalidTokenException('HS256 token received but SUPABASE_JWT_SECRET is not configured');
        }

        return $secret;
    }

    /** @return array<string, mixed> */
    private function peekHeader(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidTokenException('Malformed token');
        }

        return json_decode(JWT::urlsafeB64Decode($parts[0]), true) ?: [];
    }
}
