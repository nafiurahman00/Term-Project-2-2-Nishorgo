<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Supabase
    |--------------------------------------------------------------------------
    | Access tokens are issued by Supabase Auth. New projects sign them with
    | asymmetric keys published at {url}/auth/v1/.well-known/jwks.json; legacy
    | projects use a shared HS256 secret. Both are supported.
    */
    'supabase' => [
        'url' => rtrim((string) env('SUPABASE_URL', ''), '/'),
        'jwt_secret' => env('SUPABASE_JWT_SECRET'),
        'jwks_url' => env('SUPABASE_JWKS_URL'),
        'jwt_audience' => env('SUPABASE_JWT_AUDIENCE', 'authenticated'),
        'jwks_cache_seconds' => (int) env('SUPABASE_JWKS_CACHE_SECONDS', 600),
    ],

    /*
    |--------------------------------------------------------------------------
    | Stripe (test mode)
    |--------------------------------------------------------------------------
    | Leave STRIPE_SECRET_KEY empty to run in "demo payments" mode, where
    | orders can be marked paid from the UI without contacting Stripe.
    */
    'stripe' => [
        'secret' => env('STRIPE_SECRET_KEY'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'currency' => strtolower((string) env('STRIPE_CURRENCY', 'bdt')),
    ],

    'frontend_url' => rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/'),

    // Demo payments are only ever allowed when Stripe is not configured.
    'demo_payments' => (bool) env('DEMO_PAYMENTS', true),
];
