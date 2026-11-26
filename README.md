# 🌱 Nishorgo 2.0 — plants, care & community

Nishorgo (নিসর্গ, "nature") is a plant shop for Bangladesh rebuilt as a
**database-centric** full-stack app. Most of the business logic lives in Postgres
(Supabase) as functions, triggers, RLS policies, ledgers, materialized views and
cron jobs. A thin **PHP (Laravel 12)** API calls that logic on behalf of each
user. A **React 19** frontend provides the UI and uses Supabase Realtime for
live features.


## Features

| | |
|---|---|
| **Shop** | Full-text + fuzzy search (typo-tolerant: “lavendar” → Lavender), facets, filters, sort, infinite scroll, ⌘K command palette |
| **Plant Match** | Quiz → a scoring function in Postgres ranks every plant for your light, schedule and pets, and says *why* |
| **Checkout** | Atomic `place_order()` locks rows, commits stock via a ledger, applies coupons + Leaf Points, holds stock for 30 min |
| **Payments** | Stripe Checkout (test mode) + idempotent webhooks + automatic refunds; built-in demo mode without keys |
| **Live orders** | State-machine trigger, timeline, realtime status page, payment countdown |
| **My Garden** | Delivered plants are added by trigger; watering/feeding schedule, health score, streaks, daily reminders (pg_cron) |
| **Reviews** | Verified-purchase badge computed in SQL, photo uploads (Storage), helpful votes, exact rating aggregates |
| **Wishlist** | Price-drop and back-in-stock alerts fired by triggers |
| **Leaf Points** | Append-only loyalty ledger, tiers (Seedling → Evergreen) with earn multipliers |
| **Realtime** | Community chat rooms + expert support chat (postgres_changes), typing indicators (Broadcast), who's online & live product viewers (Presence), live purchase feed broadcast *from a database trigger*, live notifications |
| **Admin console** | KPI dashboard (materialized view), revenue chart, category bars, order heatmap, inventory ledger + sparklines, order fulfilment, coupons, customers/roles, support inbox, audit log with field diffs |
| **Auth** | Supabase Auth: email/password, magic link, Google OAuth; custom access-token hook stamps `user_role` into JWTs |
| **UI** | “Modern botanical” design, dark mode with view transitions, Motion animations, fully responsive |

## Architecture

```mermaid
flowchart LR
  subgraph Browser["React 19 + Vite + Tailwind v4"]
    UI[Pages & components]
  end
  subgraph API["Laravel 12 (PHP 8.4)"]
    MW[JWT verify<br/>JWKS / HS256] --> GW[Pg gateway<br/>set local role authenticated<br/>request.jwt.claims]
    ST[Stripe service]
  end
  subgraph SB["Supabase"]
    AUTH[Auth + token hook]
    PG[(Postgres<br/>functions · triggers · RLS<br/>ledgers · MV · pg_cron)]
    RT[Realtime]
    STO[Storage]
  end
  UI -- REST /api --> MW
  GW -- SQL as the user --> PG
  ST <-- Checkout & webhooks --> Stripe[(Stripe)]
  UI -- sign-in --> AUTH
  UI -- uploads --> STO
  PG -- changes / broadcast --> RT -- websockets --> UI
```

**Why this split?** The browser only talks to Supabase for things Supabase does
best (auth sessions, websockets, file uploads). Every read and write goes through
PHP, which **impersonates the user inside Postgres** exactly as PostgREST does.
`auth.uid()`, RLS and every `SECURITY INVOKER` function therefore behave the
same however the database is reached. A bug in PHP still can't leak another
user's data.

## The database

13 migrations in [`supabase/migrations`](supabase/migrations):

| Migration | What it builds |
|---|---|
| `01 foundation` | extensions (pg_trgm, unaccent, citext), 11 enum types, `slugify()`, generic triggers |
| `02 identity` | profiles, addresses (one-default enforced), role helpers, column-guard trigger |
| `03 catalog` | categories, products (generated `tsvector`), **append-only inventory ledger** with trigger-maintained stock |
| `04 engagement` | notifications, **loyalty ledger**, wishlist, cart (validated by trigger), signup trigger on `auth.users` |
| `05 commerce` | coupons, orders, items, status history, Stripe event log, pricing functions, **order state machine** + side-effect trigger |
| `06 reviews & garden` | verified reviews, exact rating recompute, votes, garden auto-planting, care logs → streaks |
| `07 audit & alerts` | generic row-audit trigger with column diffs; low-stock / back-in-stock / price-drop watchers |
| `08 api functions` | search, product detail, recommendations, Plant Match, cart, checkout preview, `place_order`, cancel, admin ops |
| `09 analytics` | `mv_daily_sales` materialized view, one-call `admin_dashboard()`, admin listings |
| `10 journal` | blog posts with computed reading time + “shop this story” |
| `11 security` | RLS on every table (53 policies), grants, custom access-token hook |
| `12 platform` | Realtime publication, Storage buckets + policies, 4 pg_cron jobs, care-reminder generator |
| `13 realtime chat` | rooms, messages, reactions, DB-level rate limiting, broadcast-from-database purchase feed |

Totals: **25 tables · 90+ functions · 42 triggers · 53 RLS policies · 1 materialized view · 4 cron jobs.**

Invariants enforced by the database (and covered by tests):
`products.stock = Σ inventory_movements` · `profiles.loyalty_points = Σ loyalty_ledger` ·
`stock ≥ 0` (overselling impossible) · `order.total = subtotal − discount − points + shipping` ·
legal order transitions only · ledgers and the audit log are append-only.

Tests: [`supabase/tests/database/nishorgo.test.sql`](supabase/tests/database/nishorgo.test.sql)
has 43 pgTAP tests covering RLS isolation, privilege escalation, stock/points/coupon flows,
the state machine, chat privacy and the JWT hook. Run them with `npx supabase test db`.

## Run it locally

Prerequisites: Docker, Node 20+. PHP is optional, because the API runs in Docker.

```bash
# 1. Supabase (Postgres, Auth, Realtime, Storage) — applies migrations + seeds
npx supabase start            # API on :55321, DB on :55322, Studio on :55323
npx supabase status -o env    # shows ANON_KEY / PUBLISHABLE_KEY etc.

# 2. API (Laravel)
cp backend/.env.example backend/.env
#   DB_URL=postgresql://postgres:postgres@host.docker.internal:55322/postgres
#   DB_SSLMODE=disable
#   SUPABASE_URL=http://host.docker.internal:55321
docker compose run --rm api php artisan key:generate
docker compose up --build api          # http://localhost:8000/api/health

# 3. Frontend
cd frontend && cp .env.example .env    # paste the publishable/anon key
npm install && npm run dev             # http://localhost:5173
```

Seed data, loaded in this order by `supabase db reset`:

| File | What it adds |
|---|---|
| `seed.sql` | 4 core categories, 19 plants, coupons, 5 journal posts |
| `seed_demo.sql` | Admin, plant-expert and 8 customer accounts, 150 orders, reviews, chat |
| `seed_catalog.sql` | 4 more categories, 78 more plants (97 total) with care data, 14 more journal posts |
| `seed_demo_history.sql` | 32 more customers and ~420 orders spread over six months, reviews, wishlists, care logs |

The demo files create sample users and orders, so don't run them in production.

Demo accounts (password `Nishorgo#2026`): `admin@nishorgo.test`, `expert@nishorgo.test` (staff),
`ayesha@nishorgo.test` (customer), plus customers such as `nadia.rahman@nishorgo.test`.
Coupons: `WELCOME10`, `GREEN100`, `MONSOON25`. Plant photo credits: [docs/IMAGE_CREDITS.md](docs/IMAGE_CREDITS.md).

Hosted Supabase, the MCP connector and Stripe: see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).
Deploying the storefront and API to Vercel: see [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md).

## Tech stack

- **Database:** Supabase Postgres 17, pg_trgm, unaccent, citext, pg_cron, pgTAP
- **Backend:** PHP 8.4, Laravel 12, firebase/php-jwt, stripe-php
- **Frontend:** React 19, TypeScript 7, Vite 8, Tailwind CSS v4, TanStack Query, React Router 7, Motion, Recharts, supabase-js
- **Infra:** Supabase Auth / Realtime / Storage, Stripe Checkout, Docker

## Project layout

```
supabase/   migrations, seed*.sql, tests, config.jsonc
backend/    Laravel API (app/Support/Db/Pg.php is the impersonating DB gateway)
frontend/   React app (src/pages, src/components, src/hooks/useRealtime.ts)
docs/       setup guides (Supabase, Vercel deployment)
```
