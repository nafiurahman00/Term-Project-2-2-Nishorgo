<?php

namespace App\Http\Controllers;

use App\Services\Payments;
use App\Support\Db\Pg;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Cart, wishlist, checkout and the customer's orders. */
class ShopController extends Controller
{
    public function __construct(Pg $pg, private readonly Payments $payments)
    {
        parent::__construct($pg);
    }

    // ---------------------------------------------------------------- cart
    public function cart(): Response
    {
        return $this->rpc('cart_summary');
    }

    public function addToCart(Request $request): Response
    {
        $data = $request->validate([
            'product_id' => 'required|integer|min:1',
            'quantity' => 'required|integer|min:0|max:99',
            'mode' => 'nullable|in:add,set',
        ]);

        return $this->rpc('cart_upsert', [
            'p_product_id' => (int) $data['product_id'],
            'p_quantity' => (int) $data['quantity'],
            'p_mode' => $data['mode'] ?? 'add',
        ]);
    }

    public function removeFromCart(int $productId): Response
    {
        return $this->rpc('cart_upsert', ['p_product_id' => $productId, 'p_quantity' => 0, 'p_mode' => 'set']);
    }

    public function clearCart(): Response
    {
        return $this->raw($this->pg->scope(function () {
            $this->pg->callRaw('cart_clear');

            return $this->pg->callRaw('cart_summary');
        }));
    }

    // ------------------------------------------------------------ wishlist
    public function wishlist(): Response
    {
        return $this->rpc('my_wishlist');
    }

    public function toggleWishlist(int $productId): JsonResponse
    {
        return response()->json(['wishlisted' => $this->pg->call('toggle_wishlist', ['p_product_id' => $productId])]);
    }

    // ------------------------------------------------------------ checkout
    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'coupon_code' => 'nullable|string|max:24',
            'points' => 'nullable|integer|min:0',
        ]);

        return response()->json($this->pg->call('checkout_preview', [
            'p_coupon_code' => $data['coupon_code'] ?? null,
            'p_points' => (int) ($data['points'] ?? 0),
        ]) + ['payment_mode' => $this->paymentMode()]);
    }

    public function checkout(Request $request): JsonResponse
    {
        $data = $request->validate([
            'address_id' => 'required|integer',
            'coupon_code' => 'nullable|string|max:24',
            'points' => 'nullable|integer|min:0',
            'notes' => 'nullable|string|max:500',
        ]);

        // One atomic DB transaction: price, lock & commit stock, apply coupon/points, empty cart.
        $order = $this->pg->call('place_order', [
            'p_address_id' => (int) $data['address_id'],
            'p_coupon_code' => $data['coupon_code'] ?? null,
            'p_points' => (int) ($data['points'] ?? 0),
            'p_notes' => $data['notes'] ?? null,
        ]);

        return response()->json($this->startPayment($order), 201);
    }

    // -------------------------------------------------------------- orders
    public function orders(): Response
    {
        [$limit, $offset] = $this->page(20);

        return $this->rpc('my_orders', ['p_limit' => $limit, 'p_offset' => $offset]);
    }

    public function order(string $id): Response
    {
        return $this->rpc('order_detail', ['p_order_id' => $id]);
    }

    /** Retry payment for an order that is still holding stock. */
    public function pay(string $id): JsonResponse
    {
        $order = $this->pg->call('order_detail', ['p_order_id' => $id]);
        abort_unless($order['can_pay'], 422, 'This order can no longer be paid');

        return response()->json($this->startPayment($order));
    }

    /** Demo-mode only: simulate a successful card payment. */
    public function demoPay(string $id): Response
    {
        abort_unless($this->payments->demoMode(), 404);
        $order = $this->pg->call('order_detail', ['p_order_id' => $id]);   // ownership check via RLS-aware function
        abort_unless($order['can_pay'], 422, 'This order can no longer be paid');

        $this->pg->system(fn () => $this->pg->call('private.mark_order_paid', [
            'p_order_id' => $id,
            'p_payment_intent' => 'pi_demo_'.str_replace('-', '', $id),
            'p_amount_cents' => (int) round(((float) $order['total']) * 100),
        ]));

        return $this->rpc('order_detail', ['p_order_id' => $id]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $request->validate(['reason' => 'nullable|string|max:200']);
        $result = $this->pg->call('cancel_my_order', ['p_order_id' => $id, 'p_reason' => $request->input('reason')]);

        if (($result['needs_refund'] ?? false) && $this->payments->enabled()) {
            $this->payments->refund($result['payment_intent']);
            $result['refund'] = 'initiated';
        }
        unset($result['payment_intent']);

        return response()->json($result);
    }

    // ------------------------------------------------------------- helpers
    private function startPayment(array $order): array
    {
        if ($this->payments->enabled()) {
            $session = $this->payments->createCheckoutSession($order, $this->pg->claims()['email'] ?? null);
            $this->pg->system(fn () => $this->pg->call('private.attach_checkout_session', [
                'p_order_id' => $order['id'], 'p_session_id' => $session['id'],
            ]));

            return ['order' => $order, 'payment_mode' => 'stripe', 'checkout_url' => $session['url']];
        }

        return [
            'order' => $order,
            'payment_mode' => $this->payments->demoMode() ? 'demo' : 'unavailable',
            'checkout_url' => null,
        ];
    }

    private function paymentMode(): string
    {
        return $this->payments->enabled() ? 'stripe' : ($this->payments->demoMode() ? 'demo' : 'unavailable');
    }
}
