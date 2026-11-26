<?php

namespace App\Services;

use Stripe\Event;
use Stripe\StripeClient;
use Stripe\Webhook;

/**
 * Stripe Checkout integration (test mode).
 *
 * The database decides *what* is owed (place_order() prices the order and
 * commits stock); Stripe only collects it. The webhook calls
 * private.mark_order_paid(), which re-checks the amount against the order.
 *
 * Without STRIPE_SECRET_KEY the app runs in "demo payments" mode: the
 * frontend shows a simulated card form and the API marks the order paid.
 */
class Payments
{
    private ?StripeClient $client = null;

    public function __construct(
        private readonly array $stripe,
        private readonly string $frontendUrl,
        private readonly bool $demoAllowed,
    ) {
    }

    public function enabled(): bool
    {
        return ! empty($this->stripe['secret']);
    }

    public function demoMode(): bool
    {
        return ! $this->enabled() && $this->demoAllowed;
    }

    public function currency(): string
    {
        return $this->stripe['currency'];
    }

    /**
     * @param  array<string, mixed>  $order  output of public.order_detail()
     * @return array{id: string, url: string}
     */
    public function createCheckoutSession(array $order, ?string $email): array
    {
        $currency = $this->currency();
        $cents = fn ($amount) => (int) round(((float) $amount) * 100);

        $lineItems = array_map(fn ($item) => [
            'quantity' => (int) $item['quantity'],
            'price_data' => [
                'currency' => $currency,
                'unit_amount' => $cents($item['unit_price']),
                'product_data' => array_filter([
                    'name' => $item['name'],
                    'images' => $this->absoluteImage($item['image_url'] ?? null),
                ]),
            ],
        ], $order['items']);

        if ((float) $order['shipping_fee'] > 0) {
            $lineItems[] = [
                'quantity' => 1,
                'price_data' => [
                    'currency' => $currency,
                    'unit_amount' => $cents($order['shipping_fee']),
                    'product_data' => ['name' => 'Delivery'],
                ],
            ];
        }

        $params = [
            'mode' => 'payment',
            'line_items' => $lineItems,
            'client_reference_id' => $order['id'],
            'metadata' => ['order_id' => $order['id'], 'order_number' => $order['order_number']],
            'payment_intent_data' => ['metadata' => ['order_id' => $order['id']]],
            'success_url' => "{$this->frontendUrl}/orders/{$order['id']}?paid=1",
            'cancel_url' => "{$this->frontendUrl}/orders/{$order['id']}?cancelled=1",
            // Stripe's minimum session lifetime is 30 minutes — matches our stock hold.
            'expires_at' => time() + 31 * 60,
        ];
        if ($email) {
            $params['customer_email'] = $email;
        }

        // Coupon + Leaf Points are applied as a one-off Stripe discount so the
        // Stripe total equals the database total to the poisha.
        $discount = (float) $order['discount'] + (float) $order['points_redeemed'];
        if ($discount > 0) {
            $coupon = $this->client()->coupons->create([
                'amount_off' => $cents($discount),
                'currency' => $currency,
                'duration' => 'once',
                'max_redemptions' => 1,
                'name' => trim(($order['coupon_code'] ?? '').' + Leaf Points', ' +'),
            ]);
            $params['discounts'] = [['coupon' => $coupon->id]];
        }

        $session = $this->client()->checkout->sessions->create($params, [
            'idempotency_key' => 'checkout-'.$order['id'].'-'.$order['updated_at'],
        ]);

        return ['id' => $session->id, 'url' => $session->url];
    }

    public function refund(string $paymentIntent, string $reason = 'requested_by_customer'): void
    {
        $this->client()->refunds->create(
            ['payment_intent' => $paymentIntent, 'reason' => $reason],
            ['idempotency_key' => 'refund-'.$paymentIntent],
        );
    }

    public function constructEvent(string $payload, ?string $signature): Event
    {
        return Webhook::constructEvent($payload, (string) $signature, (string) $this->stripe['webhook_secret']);
    }

    private function client(): StripeClient
    {
        return $this->client ??= new StripeClient($this->stripe['secret']);
    }

    /** @return array<int, string>|null */
    private function absoluteImage(?string $path): ?array
    {
        if (! $path) {
            return null;
        }
        $url = str_starts_with($path, 'http') ? $path : $this->frontendUrl.$path;

        // Stripe can only fetch publicly reachable https images.
        return str_starts_with($url, 'https://') ? [$url] : null;
    }
}
