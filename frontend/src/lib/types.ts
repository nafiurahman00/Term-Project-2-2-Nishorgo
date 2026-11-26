// Shapes returned by the Nishorgo API (which streams JSON built by Postgres).

export type Light = 'low' | 'medium' | 'bright_indirect' | 'full_sun'
export type Difficulty = 'easy' | 'moderate' | 'expert'
export type Role = 'customer' | 'staff' | 'admin'
export type OrderStatus = 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
export type CareTask = 'water' | 'fertilize' | 'mist' | 'prune' | 'repot'

export interface Category {
  slug: string
  name: string
  emoji: string | null
  count?: number
}

export interface ProductCard {
  id: number
  slug: string
  name: string
  scientific_name: string | null
  price: number
  compare_at_price: number | null
  image_url: string | null
  stock: number
  rating_avg: number
  rating_count: number
  light: Light
  difficulty: Difficulty
  pet_friendly: boolean
  air_purifying: boolean
  edible: boolean
  tags: string[]
  is_featured: boolean
  sold_count: number
  category: Category
  rank?: number
  reason?: string
  match?: number
  reasons?: string[]
}

export interface ProductDetail extends ProductCard {
  short_description: string | null
  description: string | null
  gallery: string[]
  water_every_days: number
  fertilize_every_days: number | null
  mature_height_cm: number | null
  wishlist_count: number
  low_stock: boolean
  rating_distribution: Record<string, number>
  is_wishlisted: boolean
  in_cart: number
  can_review: boolean
}

export interface SearchResult {
  total: number
  items: ProductCard[]
  facets: { categories: Category[]; price_range: { min: number; max: number } }
}

export interface Review {
  id: number
  rating: number
  title: string | null
  body: string | null
  photos: string[]
  is_verified_purchase: boolean
  helpful_count: number
  created_at: string
  is_mine: boolean
  has_voted: boolean
  author: { name: string; avatar_url: string | null; tier: string }
}

export interface CartItem extends ProductCard {
  quantity: number
  line_total: number
  issue: 'unavailable' | 'insufficient_stock' | null
}

export interface Cart {
  items: CartItem[]
  item_count: number
  subtotal: number
  shipping_fee: number
  free_shipping_threshold: number
  free_shipping_remaining: number
  total: number
  points_balance: number
  max_redeemable_points: number
}

export interface CheckoutPreview {
  subtotal: number
  discount: number
  coupon: { code: string; discount: number; message: string } | null
  points_redeemed: number
  points_balance: number
  max_redeemable_points: number
  shipping_fee: number
  total: number
  payment_mode: 'stripe' | 'demo' | 'unavailable'
}

export interface Address {
  id: number
  label: string
  recipient: string
  phone: string
  line1: string
  line2: string | null
  area: string | null
  city: string
  postal_code: string | null
  is_default: boolean
}

export interface OrderItem {
  id: number
  product_id: number | null
  name: string
  image_url: string | null
  unit_price: number
  quantity: number
  line_total: number
  slug: string | null
}

export interface Order {
  id: string
  order_number: string
  status: OrderStatus
  subtotal: number
  discount: number
  points_redeemed: number
  shipping_fee: number
  total: number
  points_earned: number
  shipping_address: Omit<Address, 'id' | 'is_default'>
  notes: string | null
  tracking_code: string | null
  expires_at: string | null
  placed_at: string
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  updated_at: string
  items: OrderItem[]
  timeline: { status: OrderStatus; note: string | null; at: string }[]
  coupon_code: string | null
  can_cancel: boolean
  can_pay: boolean
  customer?: { id: string; name: string; email: string } | null
}

export interface OrderSummary {
  id: string
  order_number: string
  status: OrderStatus
  total: number
  placed_at: string
  item_count: number
  thumbnails: (string | null)[]
}

export interface Account {
  id: string
  email: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  phone: string | null
  role: Role
  loyalty_points: number
  lifetime_points: number
  care_streak: number
  best_care_streak: number
  tier: 'Seedling' | 'Sprout' | 'Bloom' | 'Evergreen'
  next_tier_at: number | null
  next_tier_progress: number
  orders_count: number
  total_spent: number
  garden_count: number
  wishlist_count: number
  unread_notifications: number
  points_history: { delta: number; reason: string; note: string | null; at: string }[]
}

export interface Notification {
  id: number
  kind: 'order' | 'stock' | 'price_drop' | 'care' | 'loyalty' | 'review' | 'system' | 'admin'
  title: string
  body: string | null
  link: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export interface GardenPlant {
  id: number
  product_id: number | null
  product_slug: string | null
  nickname: string
  species: string | null
  location: string | null
  photo_url: string | null
  light: Light | null
  water_every_days: number
  fertilize_every_days: number | null
  acquired_on: string
  last_watered_at: string | null
  last_fertilized_at: string | null
  last_misted_at: string | null
  next_water_at: string
  water_due_in_days: number
  next_fertilize_at: string | null
  fertilize_due_in_days: number | null
  health: number
  recent_care: { task: CareTask; at: string; note: string | null }[]
}

export interface GardenOverview {
  plants: GardenPlant[]
  streak: { current: number; best: number; last_care_on: string | null }
  week: { tasks_done: number; days_active: number }
}

export interface ChatRoom {
  id: string
  slug?: string
  title: string
  description?: string | null
  emoji?: string | null
  status?: 'open' | 'waiting' | 'resolved'
  order_id?: string | null
  order_number?: string | null
  customer?: { id: string; name: string; avatar_url: string | null; email?: string | null }
  assigned_to?: string | null
  members?: number
  unread: number
  last_message_at: string | null
  last_message_preview: string | null
}

export interface ChatMessage {
  id: number
  room_id: string
  sender_id: string | null
  sender_name: string | null
  sender_avatar: string | null
  sender_role: Role | null
  body: string | null
  image_url: string | null
  reply_to: number | null
  is_system: boolean
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  is_mine?: boolean
  reply?: { id: number; sender_name: string; body: string } | null
  reactions?: { emoji: string; count: number; mine: boolean }[]
}

export interface JournalCard {
  slug: string
  title: string
  excerpt: string | null
  cover_url: string | null
  tags: string[]
  reading_minutes: number
  published_at: string
}

export interface JournalPost extends JournalCard {
  body: string
  author: { name: string; avatar_url: string | null } | null
  products: ProductCard[]
  more: { slug: string; title: string; cover_url: string | null; reading_minutes: number }[]
}

export interface Paged<T> {
  total: number
  items: T[]
}
