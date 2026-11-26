<?php

use App\Http\Middleware\AuthenticateSupabase;
use App\Support\Db\PgErrorMapper;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['supabase' => AuthenticateSupabase::class]);
        $middleware->throttleApi();   // named limiter 'api', see AppServiceProvider
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Database business-rule errors → clean JSON (422/403/404/409).
        $exceptions->render(function (QueryException $e, Request $request) {
            return PgErrorMapper::toResponse($e);
        });
        $exceptions->dontReportWhen(fn (Throwable $e) => $e instanceof QueryException && PgErrorMapper::toResponse($e) !== null);
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
    })->create();
