<?php

namespace App\Http\Controllers;

use App\Support\Db\PgValue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class CatalogController extends Controller
{
    private const LIGHT = ['low', 'medium', 'bright_indirect', 'full_sun'];

    private const DIFFICULTY = ['easy', 'moderate', 'expert'];

    /** Everything the landing page needs in a single round trip. */
    public function home(): JsonResponse
    {
        return response()->json($this->pg->scope(fn () => [
            'featured' => $this->pg->call('search_products', ['p_sort' => 'relevance', 'p_limit' => 8])['items'],
            'popular' => $this->pg->call('search_products', ['p_sort' => 'popular', 'p_limit' => 4])['items'],
            'categories' => $this->pg->call('search_products', ['p_limit' => 1])['facets']['categories'],
            'journal' => $this->pg->call('journal_list', ['p_limit' => 3])['items'],
            'stats' => $this->pg->selectOne(
                'select (select count(*) from public.products where is_active) as plants,
                        (select count(*) from public.reviews) as reviews,
                        (select round(avg(rating), 1) from public.reviews) as rating'
            ),
        ]));
    }

    public function search(Request $request): Response
    {
        $data = $request->validate([
            'q' => 'nullable|string|max:100',
            'category' => 'nullable|string|max:60',
            'min_price' => 'nullable|numeric|min:0',
            'max_price' => 'nullable|numeric|min:0',
            'light' => 'nullable|array', 'light.*' => 'in:'.implode(',', self::LIGHT),
            'difficulty' => 'nullable|array', 'difficulty.*' => 'in:'.implode(',', self::DIFFICULTY),
            'pet_friendly' => 'nullable|boolean',
            'in_stock' => 'nullable|boolean',
            'sort' => 'nullable|in:relevance,popular,price_asc,price_desc,rating,newest',
        ]);
        [$limit, $offset] = $this->page(12);

        return $this->rpc('search_products', [
            'p_query' => $data['q'] ?? null,
            'p_category' => $data['category'] ?? null,
            'p_min_price' => isset($data['min_price']) ? (float) $data['min_price'] : null,
            'p_max_price' => isset($data['max_price']) ? (float) $data['max_price'] : null,
            'p_light' => PgValue::array($data['light'] ?? null, 'public.light_level'),
            'p_difficulty' => PgValue::array($data['difficulty'] ?? null, 'public.care_difficulty'),
            'p_pet_friendly' => isset($data['pet_friendly']) ? $request->boolean('pet_friendly') : null,
            'p_in_stock' => isset($data['in_stock']) ? $request->boolean('in_stock') : null,
            'p_sort' => $data['sort'] ?? 'relevance',
            'p_limit' => $limit,
            'p_offset' => $offset,
        ]);
    }

    public function product(string $slug): Response
    {
        return $this->rpc('product_detail', ['p_slug' => $slug]);
    }

    public function reviews(Request $request, int $id): Response
    {
        $request->validate(['sort' => 'nullable|in:helpful,newest,highest,lowest']);
        [$limit, $offset] = $this->page(6);

        return $this->rpc('product_reviews', [
            'p_product_id' => $id, 'p_sort' => $request->input('sort', 'helpful'),
            'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }

    public function recommendations(int $id): Response
    {
        return $this->rpc('product_recommendations', ['p_product_id' => $id, 'p_limit' => 6]);
    }

    public function plantMatch(Request $request): Response
    {
        $data = $request->validate([
            'light' => 'required|in:'.implode(',', self::LIGHT),
            'experience' => 'required|in:'.implode(',', self::DIFFICULTY),
            'has_pets' => 'boolean',
            'water_tolerance' => 'integer|min:1|max:30',
            'wants' => 'array', 'wants.*' => 'in:flowers,edible,air_purifying,compact',
        ]);

        return $this->rpc('plant_match', [
            'p_light' => PgValue::of($data['light'], 'public.light_level'),
            'p_experience' => PgValue::of($data['experience'], 'public.care_difficulty'),
            'p_has_pets' => (bool) ($data['has_pets'] ?? false),
            'p_water_tolerance' => (int) ($data['water_tolerance'] ?? 7),
            'p_wants' => PgValue::array($data['wants'] ?? [], 'text'),
            'p_limit' => 6,
        ]);
    }

    public function journal(Request $request): Response
    {
        [$limit, $offset] = $this->page(9);

        return $this->rpc('journal_list', [
            'p_tag' => $request->string('tag')->limit(40)->toString() ?: null,
            'p_query' => $request->string('q')->limit(100)->toString() ?: null,
            'p_limit' => $limit, 'p_offset' => $offset,
        ]);
    }

    public function journalPost(string $slug): Response
    {
        return $this->rpc('journal_post', ['p_slug' => $slug]);
    }
}
