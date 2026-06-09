# EYL Delivery — Dashboard, Database & API

Replaces the hand-maintained "Line Up" Excel workbook with a real database
(Supabase / Postgres), a web app for data entry, and a JSON API you can wire to
other apps / automate.

**Modules:** Deliveries · Daily Lineup · Knights + monthly Salaries · Clients
(billing/GST) · Rate Cards (km-based pricing).

Stack: Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase
(service-role, server-side only) · React Hook Form + Zod · SheetJS (importer).

---

## 1. Prerequisites

- Node.js 20+ (tested on 22/25) and npm
- A Supabase project (free tier is fine)

## 2. Configure environment

Edit `.env.local` (already created; **fill in the service-role key**):

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** service-role key — server only, never shipped to the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key (optional for now) |
| `APP_PASSWORD` | Shared password for the web UI (`/login`) |
| `SESSION_SECRET` | Random string used to sign the login cookie |
| `API_KEY` | Secret for the `x-api-key` header on write/automation endpoints |

## 3. Create the database schema

Open your Supabase project → **SQL Editor** → paste the contents of
`supabase/migrations/0001_init.sql` → **Run**. (Or, with the Supabase CLI linked:
`supabase db push`.) This creates all tables, indexes, and enables RLS — access
is only via the service-role key the server holds.

## 4. Install & run

```bash
npm install
npm run dev        # http://localhost:3000  (sign in with APP_PASSWORD)
```

Production / self-host:

```bash
npm run build
npm start          # serves the standalone build
```

## 5. Import the existing Excel data

Imports knights + monthly salaries (`Sheet3`), clients (`Billind Details`), rate
cards, and the daily sheets (lineup + deliveries). Columns are matched **by
header name** (the Jan and May layouts differ), and each delivery's task date is
anchored to the **sheet's own date** rather than the error-prone cell.

```bash
# Validate parsing without writing anything:
npm run import -- --file="/path/to/Line Up - 1st Jan to 31st Dec 2026.xlsx" --month=2026-05 --dry-run

# Import May 2026:
npm run import -- --file="/path/to/Line Up ... .xlsx" --month=2026-05

# Backfill another month later (re-runs are idempotent):
npm run import -- --file="/path/to/Line Up ... .xlsx" --month=2026-04

# Everything:
npm run import -- --file="/path/to/Line Up ... .xlsx"
```

Notes:
- Re-running is safe: deliveries upsert on `(src_sheet, src_row)`; knights/clients
  are added only when missing; a day's lineup is replaced wholesale.
- Rows whose times Excel mangled into dates (e.g. `4 11` → a date) are recovered
  best-effort and flagged `needs_review = true` (find them on the dashboard or
  `/deliveries?needs_review=true`) — never dropped.

---

## API

All endpoints return JSON. **Reads** require a valid UI session **or** the API
key. **Writes** (POST/PATCH/DELETE) require the API key when called from outside
the app: send header `x-api-key: <API_KEY>`. `/api/health` is public.

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/deliveries` | List (filters: `date`, `from`, `to`, `knight_id`, `payment_status`, `client_id`, `needs_review`, `q`, `limit`, `offset`) / create |
| GET/PATCH/DELETE | `/api/deliveries/{id}` | Single delivery |
| GET/POST | `/api/lineup?date=YYYY-MM-DD` | Get / replace a day's lineup |
| GET/POST | `/api/knights` · GET/PATCH/DELETE `/api/knights/{id}` | Knights |
| GET/POST | `/api/salaries` | Monthly salary (upsert on knight+month) |
| GET/POST | `/api/clients` · GET/PATCH/DELETE `/api/clients/{id}` | Clients |
| GET/POST | `/api/rates` · PATCH/DELETE `/api/rates/{id}` | Rate tiers |
| POST | `/api/import` | Bulk-insert deliveries `{ deliveries: [...] }` (1–1000) |
| GET | `/api/health` | Health check |

### Examples

```bash
# Create a delivery from another app:
curl -X POST http://localhost:3000/api/deliveries \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
        "task_date": "2026-05-28",
        "sender_name": "Alison",
        "pickup_location": "Mahim",
        "drop_location": "Bandra W",
        "drop_recipient_name": "Reshma",
        "knight_name": "Raju",
        "fees": 100,
        "payment_status": "unpaid",
        "mode_of_booking": "online"
      }'

# List a day's deliveries:
curl "http://localhost:3000/api/deliveries?date=2026-05-02" -H "x-api-key: $API_KEY"

# Bulk import:
curl -X POST http://localhost:3000/api/import \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{ "deliveries": [ { "task_date":"2026-05-28", "sender_name":"X", "fees":50 } ] }'
```

`knight_name` accepts a short name (e.g. `Raju`), a combo (`Rohit/Sachin`), an
external provider (`We fast`, `Uber`, `self`), or `CANCELLED`. The server resolves
the `knight_id` automatically when the name matches a knight.

---

## Self-hosting with Docker

```bash
docker build -t eyl-dashboard .
docker run -p 3000:3000 --env-file .env.local eyl-dashboard
```

The image uses Next.js standalone output and runs `node server.js`, executes as a
non-root user, and ships a `HEALTHCHECK` against `/api/health`.

### Hardened deploy (Docker Compose)

For self-hosting, a hardened `docker-compose.yml` is included:

```bash
docker compose up -d --build                  # app only, on 127.0.0.1:3000
docker compose --profile proxy up -d --build  # app + Caddy (auto-HTTPS) on 80/443
```

Applied hardening:

- **Non-root** runtime user, `no-new-privileges`, **all Linux capabilities dropped**
- **Read-only root filesystem** (only `/tmp` and `/app/.next/cache` are writable tmpfs)
- **Resource limits** (1 CPU / 512 MB) and **log rotation** (10 MB × 3)
- Container **healthcheck** wired into Compose; Caddy waits for healthy before routing
- **Security headers** at the app (`next.config.mjs`) and edge (`deploy/Caddyfile`), plus HSTS over TLS
- Secrets passed via `env_file` with `format: raw` so values containing `$` aren't mangled by Compose interpolation
- App bound to loopback unless the `proxy` profile (Caddy, automatic Let's Encrypt TLS) is enabled

See [`DEPLOY.md`](DEPLOY.md) for the full runbook and the remaining
production-readiness gaps (secrets rotation, real auth, etc.).

---

## Project layout

```
app/(app)/...        web pages (dashboard, deliveries, lineup, knights, salaries, clients, rates)
app/api/...          JSON API route handlers
app/login            shared-password login
components/          forms + UI
lib/parse/           date/time/knight/header normalizers (shared by API + importer)
lib/schemas/         Zod validation (shared by forms + API)
lib/supabase/        service-role client
supabase/migrations/ SQL schema
scripts/import-excel.ts   the workbook importer
middleware.ts        auth gate
```

## Data model (high level)

`knights` ← `knight_salaries` (monthly) · `work_days` ← `daily_assignments`
(per-knight lineup) · `clients` (billing/GST) · `rate_tiers` (km pricing) ·
`deliveries` (the core table, with billing + invoice fields and `needs_review`
/ `src_sheet` provenance).
