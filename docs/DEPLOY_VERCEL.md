# Deploying Nishorgo to Vercel

You end up with two Vercel projects built from this one repository:

| Vercel project | Root directory | What it is | URL (example) |
|---|---|---|---|
| `nishorgo` | `frontend/` | React storefront (static) | `https://nishorgo.vercel.app` |
| `nishorgo-api` | `backend/` | Laravel API ([vercel-php](https://github.com/vercel-community/php) runtime, PHP 8.4) | `https://nishorgo-api.vercel.app` |

The storefront forwards `/api/*` to the API project, so the browser only ever talks to one origin and no CORS
setup is needed. Supabase (database, auth, realtime, storage, cron) is already hosted and isn't part of Vercel.

```
browser ──▶ nishorgo.vercel.app ──(/api/* rewrite)──▶ nishorgo-api.vercel.app ──▶ Supabase Postgres (Tokyo)
   └──────────── supabase-js (auth, realtime, storage) ─────────────────────────────▶ Supabase
```

The API function is pinned to the Tokyo region (`hnd1`), next to the database. Each request makes several
database round-trips, so being in the same region keeps responses fast.

---

## 1. Push the code

Vercel builds from GitHub. Commit the revamp and push it to `main`, or to a branch you'll deploy from.

## 2. Create the API project (`nishorgo-api`)

1. Vercel dashboard → **Add New… → Project** → import `Term-Project-2-2-Nishorgo`.
2. **Project name:** `nishorgo-api`
3. **Root Directory:** `backend`
4. **Framework Preset:** Other. `backend/vercel.json` already selects the PHP runtime and routes every request.
5. **Environment Variables:**

| Name | Value |
|---|---|
| `APP_KEY` | Copy the `APP_KEY=base64:…` value from your local `backend/.env` |
| `DB_URL` | Supabase **Connect → Transaction pooler** string, port **6543**, with your DB password filled in:<br>`postgresql://postgres.aovlcwddqmvtdrvkqfdx:<password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres` |
| `DB_SSLMODE` | `require` |
| `SUPABASE_URL` | `https://aovlcwddqmvtdrvkqfdx.supabase.co` |
| `FRONTEND_URL` | `https://nishorgo.vercel.app`, or your storefront URL once it exists |
| `DEMO_PAYMENTS` | `true` (checkout works without Stripe). Set it to `false` once Stripe keys are added. |
| `STRIPE_SECRET_KEY` | *(optional)* `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | *(optional)* `whsec_…` from step 5 |

6. **Deploy**, then open `https://nishorgo-api.vercel.app/api/health`. It should return `{"ok":true,…}`.

`api/index.php` handles the serverless details itself:
- caches, compiled views and framework manifests are written to `/tmp`
- logs go to stderr, so they show up in Vercel's logs
- there are no sessions
- the script path is corrected so Laravel's `/api/...` routes resolve

You don't need to set any of these yourself.

## 3. Create the storefront project (`nishorgo`)

1. **Add New… → Project** → import the same repository again.
2. **Project name:** `nishorgo`
3. **Root Directory:** `frontend`. The framework (Vite) is detected from `frontend/vercel.json`.
4. **Environment Variables:**

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://aovlcwddqmvtdrvkqfdx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_IjpIoNk9R3ijeojnteOcoA_6INDE4KY` |
| `VITE_SHOW_DEMO_ACCOUNTS` | `true` shows the one-click demo logins on the sign-in page; use `false` for a real launch |

5. **Deploy.**

> **If your API project ended up with a different URL** (for example `nishorgo-api-abc.vercel.app`), edit the
> first rewrite in `frontend/vercel.json` to point at it, then push again.

## 4. Point Supabase Auth at the new site

Supabase dashboard → **Authentication**:

- **URL Configuration**
  - **Site URL:** `https://nishorgo.vercel.app`
  - **Redirect URLs:** `https://nishorgo.vercel.app/**`. Keep `http://localhost:5173/**` so local development still works.
- **Hooks → Custom Access Token:** turn it on and choose `public.custom_access_token_hook`. Without it, admin and staff
  accounts sign in but don't get the admin console.

## 5. Stripe (optional)

1. Stripe Dashboard (test mode) → **Developers → Webhooks → Add endpoint**
   - URL: `https://nishorgo.vercel.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
2. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` on the **API** project, set `STRIPE_SECRET_KEY`, set
   `DEMO_PAYMENTS=false`, and redeploy the API.

## Deploying from the CLI instead

```bash
npx vercel login
cd backend  && npx vercel link --project nishorgo-api && npx vercel --prod
cd ../frontend && npx vercel link --project nishorgo && npx vercel --prod
```

Environment variables still go in the dashboard, or use `npx vercel env add NAME production`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Every API call returns 500, and the logs show `Network unreachable` | `DB_URL` is the *direct* connection (IPv6 only). Use the **pooler** host instead. |
| Logs show `(ENOTFOUND) tenant/user … not found` | Wrong pooler region or username. It must be `postgres.aovlcwddqmvtdrvkqfdx` @ `aws-1-ap-northeast-1`. |
| `/api/*` returns the storefront's HTML | The rewrite in `frontend/vercel.json` points at the wrong API URL. |
| Signed in, but you get 401 from the API | `SUPABASE_URL` on the API project is wrong. It's used to fetch the token-signing keys. |
| Admin console missing for the admin account | Enable the Custom Access Token hook (step 4), then sign out and back in. |
| First request after a while is slow (~1–2 s) | Serverless cold start. That's expected. |

**Note:** the `vercel-php` community runtime was archived in October 2026. Its published versions keep working, but
it won't get updates. If it ever stops building, deploy `backend/` with its `Dockerfile` to Render, Railway or Fly
instead. The code doesn't change, only the rewrite URL in `frontend/vercel.json` does.
