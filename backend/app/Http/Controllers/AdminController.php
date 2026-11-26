<?php

namespace App\Http\Controllers;

use App\Services\Payments;
use App\Support\Db\Pg;
use App\Support\Db\PgValue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Admin console. Authorisation is enforced *in the database* — every admin
 * function starts with private.require_staff() — so even a bug in this layer
 * cannot leak data to customers.
 */
class AdminController extends Controller
{
    public function __construct(Pg $pg, private readonly Payments $payments)
    {
        parent::__construct($pg);
    }

    public function dashboard(Request $request): Response
    {
        $request->validate(['days' => 'nullable|integer|min:7|max:365']);

        return $this->rpc('admin_dashboard', ['p_days' => (int) $request->input('days', 30)]);
    }

    public function refreshAnalytics(): Response
    {
        $this->pg->call('admin_refresh_analytics');

        return $this->dashboard(request());
    }

    // -------------------------------------------------------------- orders
    public function orders(Request $request): Response
    {
        $request->validate([
            'status' => 'nullable|in:pending_payment,paid,processing,shipped,delivered,cancelled,refunded',
            'q' => 'nullable|string|max:100',
        ]);
        [$limit, $offset] = $this->page(25);

        return $this->rpc('admin_list_orders', [
            'p_status' => $request->filled('status') ? PgValue::of($request->input('status'), 'public.order_status') : null,
            'p_query' => $request->input('q'),
            'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }

    public function order(string $id): Response
    {
        return $this->rpc('order_detail', ['p_order_id' => $id]);
    }

    public function setOrderStatus(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'status' => 'required|in:paid,processing,shipped,delivered,cancelled,refunded',
            'note' => 'nullable|string|max:300',
            'tracking_code' => 'nullable|string|max:60',
        ]);

        $result = $this->pg->call('admin_set_order_status', [
            'p_order_id' => $id,
            'p_status' => PgValue::of($data['status'], 'public.order_status'),
            'p_note' => $data['note'] ?? null,
            'p_tracking_code' => $data['tracking_code'] ?? null,
        ]);

        if (($result['needs_refund'] ?? false) && $this->payments->enabled()
            && ! str_starts_with((string) $result['payment_intent'], 'pi_demo_')) {
            $this->payments->refund($result['payment_intent'], 'requested_by_customer');
            $result['refund'] = 'initiated';
        }
        unset($result['payment_intent']);

        return response()->json($result);
    }

    // ------------------------------------------------------------ products
    public function products(Request $request): Response
    {
        $request->validate(['stock' => 'nullable|in:low,out,inactive']);
        [$limit, $offset] = $this->page(50);

        return $this->rpc('admin_list_products', [
            'p_query' => $request->input('q'),
            'p_category' => $request->input('category'),
            'p_stock' => $request->input('stock'),
            'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }

    public function saveProduct(Request $request, ?int $id = null): Response
    {
        $required = $id ? 'sometimes' : 'required';
        $data = $request->validate([
            'name' => "{$required}|string|min:2|max:80",
            'slug' => 'sometimes|nullable|string|max:90',
            'scientific_name' => 'sometimes|nullable|string|max:120',
            'category' => "{$required}|string|max:60",
            'short_description' => 'sometimes|nullable|string|max:200',
            'description' => 'sometimes|nullable|string|max:10000',
            'price' => "{$required}|numeric|min:1|max:1000000",
            'compare_at_price' => 'sometimes|nullable|numeric|gt:price',
            'stock' => 'sometimes|integer|min:0|max:100000',
            'low_stock_threshold' => 'sometimes|integer|min:0|max:1000',
            'image_url' => 'sometimes|nullable|string|max:500',
            'gallery' => 'sometimes|array|max:8', 'gallery.*' => 'string|max:500',
            'light' => 'sometimes|in:low,medium,bright_indirect,full_sun',
            'difficulty' => 'sometimes|in:easy,moderate,expert',
            'water_every_days' => 'sometimes|integer|min:1|max:60',
            'fertilize_every_days' => 'sometimes|nullable|integer|min:7|max:365',
            'pet_friendly' => 'sometimes|boolean',
            'air_purifying' => 'sometimes|boolean',
            'edible' => 'sometimes|boolean',
            'mature_height_cm' => 'sometimes|nullable|integer|min:1|max:5000',
            'tags' => 'sometimes|array|max:12', 'tags.*' => 'string|max:30',
            'is_active' => 'sometimes|boolean',
            'is_featured' => 'sometimes|boolean',
        ]);
        if ($id) {
            $data['id'] = $id;
        }

        return $this->rpc('admin_upsert_product', ['p_payload' => PgValue::json($data)], $id ? 200 : 201);
    }

    public function restock(Request $request, int $id): Response
    {
        $data = $request->validate([
            'delta' => 'required|integer|not_in:0|min:-10000|max:10000',
            'reason' => 'nullable|in:restock,adjustment,damage',
            'note' => 'nullable|string|max:200',
        ]);

        return $this->rpc('restock_product', [
            'p_product_id' => $id,
            'p_delta' => (int) $data['delta'],
            'p_reason' => PgValue::of($data['reason'] ?? 'restock', 'public.inventory_reason'),
            'p_note' => $data['note'] ?? null,
        ]);
    }

    public function inventory(int $id): Response
    {
        return $this->rpc('admin_product_inventory', ['p_product_id' => $id]);
    }

    // ----------------------------------------------------------- customers
    public function customers(Request $request): Response
    {
        [$limit, $offset] = $this->page(25);

        return $this->rpc('admin_list_customers', [
            'p_query' => $request->input('q'), 'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }

    public function setRole(Request $request, string $userId): Response
    {
        $data = $request->validate(['role' => 'required|in:customer,staff,admin']);
        $this->pg->call('admin_set_role', [
            'p_user_id' => $userId, 'p_role' => PgValue::of($data['role'], 'public.user_role'),
        ]);

        return response()->noContent();
    }

    // ------------------------------------------------------------- coupons
    public function coupons(): Response
    {
        return $this->rpc('admin_list_coupons');
    }

    public function saveCoupon(Request $request): Response
    {
        $data = $request->validate([
            'code' => ['required', 'regex:/^[A-Za-z0-9_-]{3,24}$/'],
            'description' => 'nullable|string|max:200',
            'kind' => 'required|in:percent,fixed',
            'value' => 'required|numeric|min:1',
            'min_subtotal' => 'nullable|numeric|min:0',
            'max_discount' => 'nullable|numeric|min:1',
            'starts_at' => 'nullable|date',
            'ends_at' => 'nullable|date|after:starts_at',
            'usage_limit' => 'nullable|integer|min:1',
            'per_user_limit' => 'nullable|integer|min:1',
            'is_active' => 'nullable|boolean',
        ]);

        return $this->rpc('admin_upsert_coupon', ['p_payload' => PgValue::json($data)], 201);
    }

    // --------------------------------------------------------------- audit
    public function audit(Request $request): Response
    {
        $request->validate(['table' => 'nullable|in:products,categories,coupons,orders,profiles']);
        [$limit, $offset] = $this->page(50);

        return $this->rpc('admin_audit_log', [
            'p_table' => $request->input('table'), 'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }
}
