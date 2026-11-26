<?php

namespace App\Http\Middleware;

use App\Support\Db\Pg;
use App\Support\Supabase\InvalidTokenException;
use App\Support\Supabase\JwtVerifier;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verifies the Supabase access token (Authorization: Bearer …) and binds the
 * caller's identity to the database gateway.
 *
 *   ->middleware('supabase')            token required
 *   ->middleware('supabase:optional')   anonymous allowed (catalog, chat rooms…)
 */
class AuthenticateSupabase
{
    public function __construct(private readonly JwtVerifier $verifier, private readonly Pg $pg)
    {
    }

    public function handle(Request $request, Closure $next, string $mode = 'required'): Response
    {
        $token = $request->bearerToken();

        if (! $token) {
            if ($mode === 'optional') {
                $this->pg->actingAs(null);

                return $next($request);
            }

            return $this->unauthorized('Please sign in to continue');
        }

        try {
            $claims = $this->verifier->verify($token);
        } catch (InvalidTokenException $e) {
            return $this->unauthorized($e->getMessage());
        }

        $this->pg->actingAs($claims);
        $request->attributes->set('supabase.claims', $claims);

        return $next($request);
    }

    private function unauthorized(string $message): Response
    {
        return response()->json(['message' => $message, 'code' => 'unauthenticated'], 401);
    }
}
