# Supabase setup (hosted project + MCP connector)

This guide takes you from zero to a hosted Supabase project running the Nishorgo
schema, with the **Supabase MCP server** connected to Claude Code so Claude can
apply migrations, run SQL, check advisors and debug for you.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a region close to Bangladesh (e.g. *Southeast Asia (Singapore)*), set a
   strong database password and **save it** — the PHP API needs it.
3. When it's ready, open **Project Settings → General** and copy the
   **Project ID** (a 20-character "project ref", e.g. `abcdefghijklmnopqrst`).

## 2. Connect the Supabase MCP server to Claude Code

The official remote MCP server lives at `https://mcp.supabase.com/mcp` and uses
OAuth — no access token to paste.

```bash
# from the repo root — writes .mcp.json so the whole project shares the config.
# Scope it to ONE project with project_ref (otherwise it can see your whole org).
claude mcp add --scope project --transport http supabase \
  "https://mcp.supabase.com/mcp?project_ref=<your-project-ref>"
```

Then authenticate:

1. Start (or restart) Claude Code in this folder: `claude`
2. Type `/mcp`, choose **supabase**, and pick **Authenticate**.
3. A browser window opens — sign in to Supabase and approve access for your org.
4. Check it: `claude mcp list` should show `supabase … ✓ connected`.

> **Tips**
> - Add `&read_only=true` to the URL for a safe, query-only connection (you'll
>   need write access once, to apply the migrations).
> - Add `&features=database,docs,debugging,development` to limit the tool set.
> - Keep MCP pointed at a **development** project, never production data.
> - The local CLI stack also exposes MCP at `http://127.0.0.1:55321/mcp`.

## 3. Apply the database (via MCP — or the CLI)

**With MCP (ask Claude):**

> "Apply every file in `supabase/migrations` to my Supabase project in order
> using `apply_migration`, then run `supabase/seed.sql` with `execute_sql`, then
> run the security and performance advisors."

Then run `supabase/seed_catalog.sql` for the full 97-plant catalogue. Optionally
also run `supabase/seed_demo.sql` and then `supabase/seed_demo_history.sql` to get
demo accounts and six months of order history (**development only**).

**Without MCP (Supabase CLI):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # applies supabase/migrations/*
psql "$DB_URL" -f supabase/seed.sql
psql "$DB_URL" -f supabase/seed_catalog.sql
```

### Upload the catalogue photos

Plant photos and journal covers are served from the `product-images` Storage
bucket. The database stores paths such as `/plants/rose.webp`, and the app turns
them into public Storage URLs. Upload the source files once per project:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> \
STAFF_EMAIL=<an admin or staff email> STAFF_PASSWORD=<their password> \
node supabase/scripts/upload-storage.mjs
```

The script signs in as that account; the bucket's RLS policy only lets staff
write to it. Locally, `supabase db reset` or `npx supabase seed buckets --local`
uploads the same folder automatically. Photos that admins add in the console
go straight to the bucket under `catalog/`.

## 4. Dashboard settings (one-time)

| Setting | Where | Value |
|---|---|---|
| Custom Access Token hook | Authentication → Hooks → *Customize Access Token* | Postgres function `public.custom_access_token_hook` |
| Site URL | Authentication → URL Configuration | `http://localhost:5173` (and your production URL) |
| Redirect URLs | same page | `http://localhost:5173/**`, `https://your-domain/**` |
| Google sign-in (optional) | Authentication → Sign In / Providers → Google | client id + secret from Google Cloud |
| pg_cron | Integrations → Cron | already enabled by the migration — jobs appear here |

## 5. Environment variables

**backend/.env**

```dotenv
DB_URL=postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DB_SSLMODE=require
SUPABASE_URL=https://<ref>.supabase.co
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:5173
```

Use the **Session pooler** string from *Connect* (the API connects as `postgres`
so it can `set local role authenticated` to impersonate users).

**frontend/.env**

```dotenv
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # Project Settings → API Keys
```

## 6. Stripe (test mode)

1. Get test keys at <https://dashboard.stripe.com/test/apikeys>.
2. Forward webhooks locally:
   ```bash
   stripe listen --forward-to localhost:8000/api/stripe/webhook \
     --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed
   ```
   Put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
3. Pay with card `4242 4242 4242 4242`, any future date, any CVC.

Leave `STRIPE_SECRET_KEY` empty to use the built-in **demo payments** mode.
