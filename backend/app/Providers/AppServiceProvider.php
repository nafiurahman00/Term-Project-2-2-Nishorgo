<?php

namespace App\Providers;

use App\Services\Payments;
use App\Support\Db\Pg;
use App\Support\Supabase\JwtVerifier;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One gateway per request: it carries the caller's identity.
        $this->app->scoped(Pg::class, fn ($app) => new Pg($app['db']->connection()));

        $this->app->singleton(JwtVerifier::class, fn () => new JwtVerifier(config('nishorgo.supabase')));

        $this->app->singleton(Payments::class, fn () => new Payments(
            config('nishorgo.stripe'),
            config('nishorgo.frontend_url'),
            config('nishorgo.demo_payments'),
        ));
    }

    public function boot(): void
    {
        // Keyed per caller (token if present, else IP), separate buckets per limiter.
        $caller = fn (Request $r) => sha1(($r->bearerToken() ?? '').'|'.$r->ip());

        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(240)->by('api|'.$caller($r)));
        RateLimiter::for('checkout', fn (Request $r) => Limit::perMinute(10)->by('checkout|'.$caller($r)));
    }
}
