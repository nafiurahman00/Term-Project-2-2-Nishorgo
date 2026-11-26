<?php

// Vercel entry point (vercel-php runtime). vercel.json routes every request
// here; we apply serverless-safe defaults and hand off to Laravel.
//
// Vercel's filesystem is read-only except /tmp, so every file Laravel would
// normally write (caches, compiled views, manifests) is redirected there.
// Values set in the Vercel dashboard take precedence over these defaults.
$defaults = [
    'APP_ENV' => 'production',
    'APP_DEBUG' => 'false',
    'LOG_CHANNEL' => 'stderr',
    'SESSION_DRIVER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
    'BROADCAST_CONNECTION' => 'log',
    'CACHE_STORE' => 'file',
    'CACHE_PATH' => '/tmp/cache',
    'VIEW_COMPILED_PATH' => '/tmp',
    'APP_CONFIG_CACHE' => '/tmp/config.php',
    'APP_EVENTS_CACHE' => '/tmp/events.php',
    'APP_PACKAGES_CACHE' => '/tmp/packages.php',
    'APP_ROUTES_CACHE' => '/tmp/routes.php',
    'APP_SERVICES_CACHE' => '/tmp/services.php',
];

foreach ($defaults as $key => $value) {
    if (getenv($key) === false) {
        putenv("$key=$value");
        $_ENV[$key] = $_SERVER[$key] = $value;
    }
}

// The function lives at /api/index.php, which would make Laravel treat "/api"
// as the app's base path and strip it from every route (all of ours start with
// /api). Present the request as if it came through public/index.php instead.
$_SERVER['SCRIPT_FILENAME'] = dirname(__DIR__).'/public/index.php';
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';

require __DIR__.'/../public/index.php';
