<?php

namespace App\Http\Controllers;

use App\Services\Payments;
use App\Support\Db\Pg;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Stripe\Exception\SignatureVerificationException;
use Throwable;
use UnexpectedValueException;

/**
 * Stripe → Nishorgo. Every event is stored in public.stripe_events first
 * (primary key = Stripe event id), which makes redelivered events no-ops.
 */
class StripeWebhookController extends Controller
{
    public function __construct(Pg $pg, private readonly Payments $payments)
    {
        parent::__construct($pg);
    }

    public function __invoke(Request $request): JsonResponse
    {
        abort_unless($this->payments->enabled(), 404);

        try {
            $event = $this->payments->constructEvent($request->getContent(), $request->header('Stripe-Signature'));
        } catch (SignatureVerificationException|UnexpectedValueException) {
            return response()->json(['message' => 'Invalid signature'], 400);
        }

        $isNew = $this->pg->system(fn () => $this->pg->selectOne(
            'insert into public.stripe_events (id, type, payload) values (?, ?, ?::jsonb)
             on conflict (id) do nothing returning id',
            [$event->id, $event->type, json_encode($event->toArray())]
        ));
        if (! $isNew) {
            return response()->json(['received' => true, 'duplicate' => true]);
        }

        try {
            $this->handle($event->type, $event->data->object->toArray());
            $this->mark($event->id, null);
        } catch (Throwable $e) {
            $this->mark($event->id, $e->getMessage());
            Log::error('Stripe webhook failed', ['event' => $event->id, 'error' => $e->getMessage()]);
            // Let Stripe retry: remove the idempotency row so the retry is processed.
            $this->pg->system(fn () => $this->pg->select('delete from public.stripe_events where id = ?', [$event->id]));

            return response()->json(['message' => 'Processing failed'], 500);
        }

        return response()->json(['received' => true]);
    }

    private function handle(string $type, array $session): void
    {
        $orderId = $session['metadata']['order_id'] ?? $session['client_reference_id'] ?? null;
        if (! $orderId) {
            return;
        }

        match ($type) {
            'checkout.session.completed', 'checkout.session.async_payment_succeeded' => $this->paid($orderId, $session),
            'checkout.session.expired', 'checkout.session.async_payment_failed' => $this->expired($orderId),
            default => null,
        };
    }

    private function paid(string $orderId, array $session): void
    {
        if (($session['payment_status'] ?? null) !== 'paid') {
            return;   // async methods: wait for async_payment_succeeded
        }

        $result = $this->pg->system(fn () => $this->pg->call('private.mark_order_paid', [
            'p_order_id' => $orderId,
            'p_payment_intent' => $session['payment_intent'],
            'p_amount_cents' => (int) $session['amount_total'],
        ]));

        // Paid after the stock hold expired and the order was cancelled → refund.
        if ($result['needs_refund'] ?? false) {
            $this->payments->refund($session['payment_intent'], 'requested_by_customer');
        }
    }

    private function expired(string $orderId): void
    {
        $this->pg->system(function () use ($orderId) {
            $this->pg->select("select set_config('nishorgo.status_note', 'Stripe checkout expired', true)");
            $this->pg->select(
                "update public.orders set status = 'cancelled' where id = ? and status = 'pending_payment'",
                [$orderId]
            );
        });
    }

    private function mark(string $eventId, ?string $error): void
    {
        $this->pg->system(fn () => $this->pg->select(
            'update public.stripe_events set processed_at = now(), error = ? where id = ?',
            [$error, $eventId]
        ));
    }
}
