<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\CatalogController;
use App\Http\Controllers\CommunityController;
use App\Http\Controllers\ShopController;
use App\Http\Controllers\StripeWebhookController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Nishorgo API  (prefix: /api)
|--------------------------------------------------------------------------
| supabase:optional → anonymous browsing allowed; RLS decides what's visible.
| supabase          → a valid Supabase access token is required.
*/

Route::get('/health', fn () => ['ok' => true, 'time' => now()->toIso8601String()]);

Route::post('/stripe/webhook', StripeWebhookController::class)->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

// ------------------------------------------------------------- public
Route::middleware('supabase:optional')->group(function () {
    Route::get('/home', [CatalogController::class, 'home']);
    Route::get('/products', [CatalogController::class, 'search']);
    Route::get('/products/{slug}', [CatalogController::class, 'product']);
    Route::get('/products/{id}/reviews', [CatalogController::class, 'reviews'])->whereNumber('id');
    Route::get('/products/{id}/recommendations', [CatalogController::class, 'recommendations'])->whereNumber('id');
    Route::post('/plant-match', [CatalogController::class, 'plantMatch']);
    Route::get('/journal', [CatalogController::class, 'journal']);
    Route::get('/journal/{slug}', [CatalogController::class, 'journalPost']);

    Route::get('/chat/rooms', [CommunityController::class, 'rooms']);
    Route::get('/chat/rooms/{room}/messages', [CommunityController::class, 'messages'])->whereUuid('room');
});

// ------------------------------------------------------- signed in
Route::middleware('supabase')->group(function () {
    Route::get('/me', [AccountController::class, 'me']);
    Route::patch('/me', [AccountController::class, 'update']);
    Route::get('/me/addresses', [AccountController::class, 'addresses']);
    Route::post('/me/addresses', [AccountController::class, 'storeAddress']);
    Route::patch('/me/addresses/{id}', [AccountController::class, 'updateAddress'])->whereNumber('id');
    Route::delete('/me/addresses/{id}', [AccountController::class, 'destroyAddress'])->whereNumber('id');
    Route::get('/notifications', [AccountController::class, 'notifications']);
    Route::post('/notifications/read', [AccountController::class, 'markRead']);

    Route::get('/cart', [ShopController::class, 'cart']);
    Route::post('/cart/items', [ShopController::class, 'addToCart']);
    Route::delete('/cart/items/{product}', [ShopController::class, 'removeFromCart'])->whereNumber('product');
    Route::delete('/cart', [ShopController::class, 'clearCart']);
    Route::get('/wishlist', [ShopController::class, 'wishlist']);
    Route::post('/wishlist/{product}', [ShopController::class, 'toggleWishlist'])->whereNumber('product');

    Route::post('/checkout/preview', [ShopController::class, 'preview']);
    Route::post('/checkout', [ShopController::class, 'checkout'])->middleware('throttle:checkout');
    Route::get('/orders', [ShopController::class, 'orders']);
    Route::get('/orders/{id}', [ShopController::class, 'order'])->whereUuid('id');
    Route::post('/orders/{id}/pay', [ShopController::class, 'pay'])->whereUuid('id');
    Route::post('/orders/{id}/demo-pay', [ShopController::class, 'demoPay'])->whereUuid('id');
    Route::post('/orders/{id}/cancel', [ShopController::class, 'cancel'])->whereUuid('id');

    Route::post('/products/{id}/reviews', [CommunityController::class, 'review'])->whereNumber('id');
    Route::post('/reviews/{id}/vote', [CommunityController::class, 'vote'])->whereNumber('id');

    Route::get('/garden', [CommunityController::class, 'garden']);
    Route::post('/garden/plants', [CommunityController::class, 'addPlant']);
    Route::patch('/garden/plants/{id}', [CommunityController::class, 'updatePlant'])->whereNumber('id');
    Route::delete('/garden/plants/{id}', [CommunityController::class, 'removePlant'])->whereNumber('id');
    Route::post('/garden/plants/{id}/care', [CommunityController::class, 'logCare'])->whereNumber('id');

    Route::post('/chat/rooms/{room}/messages', [CommunityController::class, 'send'])->whereUuid('room');
    Route::post('/chat/rooms/{room}/read', [CommunityController::class, 'markRoomRead'])->whereUuid('room');
    Route::post('/chat/rooms/{room}/resolve', [CommunityController::class, 'resolveSupport'])->whereUuid('room');
    Route::patch('/chat/messages/{id}', [CommunityController::class, 'editMessage'])->whereNumber('id');
    Route::delete('/chat/messages/{id}', [CommunityController::class, 'deleteMessage'])->whereNumber('id');
    Route::post('/chat/messages/{id}/reactions', [CommunityController::class, 'react'])->whereNumber('id');
    Route::post('/support', [CommunityController::class, 'openSupport']);

    // -------------------------------------------------- staff/admin
    // (authorisation is enforced by the database functions themselves)
    Route::prefix('admin')->group(function () {
        Route::get('/dashboard', [AdminController::class, 'dashboard']);
        Route::post('/analytics/refresh', [AdminController::class, 'refreshAnalytics']);
        Route::get('/orders', [AdminController::class, 'orders']);
        Route::get('/orders/{id}', [AdminController::class, 'order'])->whereUuid('id');
        Route::patch('/orders/{id}/status', [AdminController::class, 'setOrderStatus'])->whereUuid('id');
        Route::get('/products', [AdminController::class, 'products']);
        Route::post('/products', [AdminController::class, 'saveProduct']);
        Route::patch('/products/{id}', [AdminController::class, 'saveProduct'])->whereNumber('id');
        Route::post('/products/{id}/restock', [AdminController::class, 'restock'])->whereNumber('id');
        Route::get('/products/{id}/inventory', [AdminController::class, 'inventory'])->whereNumber('id');
        Route::get('/customers', [AdminController::class, 'customers']);
        Route::patch('/customers/{id}/role', [AdminController::class, 'setRole'])->whereUuid('id');
        Route::get('/coupons', [AdminController::class, 'coupons']);
        Route::post('/coupons', [AdminController::class, 'saveCoupon']);
        Route::get('/audit', [AdminController::class, 'audit']);
    });
});
