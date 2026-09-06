# QueueLess++

Multi-tenant appointment booking platform. The core engineering problem it
solves is guaranteeing that **two customers can never book the same slot
under concurrent load** — and extending that same correctness guarantee to
holds, rescheduling, and cascading provider/service changes.

See [`queueless-plus-plus-architecture.md`](./queueless-plus-plus-architecture.md)
for the full design (schema, state machine, transaction strategy, Redis
usage, queue/real-time architecture) and
[`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the phase-by-phase work
breakdown. This README is how to run and understand what's in the repo
today.

## What works today (through Phase 5)

- **Auth** — owner signup (business + owner created in one Mongo
  transaction), login, logout, "log out everywhere". Server-side opaque
  sessions in Redis behind an `HttpOnly; Secure; SameSite=Strict` cookie —
  never JWT. `role`/`businessId`/`status` are re-read fresh from Mongo on
  every request. Login is rate-limited per-account (5 failures → 15-minute
  lockout, not bypassable with the correct password mid-window) and per-IP,
  both atomic in Redis, fail-closed if Redis is down.
- **Tenant setup** — business settings, services (CRUD + deactivate/
  reactivate cascade), resources (CRUD + retire/reactivate cascade),
  provider availability templates, weekly slot generation (DST-aware, one
  `Slot` per capacity unit, idempotent).
- **Staff lifecycle** — owner invites by email → invitee sets a password
  via a one-time token → staff account created in one transaction. Removal
  is a soft state change that cascades (availability deleted, future
  open/held slots cancelled, sessions invalidated); confirmed bookings are
  left for manual follow-up.
- **Booking engine** — anonymous `hold` → `confirm` for customers, atomic
  `available → held → confirmed` conditional writes fenced by a
  `holdVersion` token and a Redis TTL hold. Concurrent racers on a
  capacity-N bucket get exactly N wins and the rest `409`. Staff/owner
  walk-in books `available → confirmed` directly. Manual slot blocking.
- **Customer self-service** — each booking gets a single-use magic-link
  token (256-bit, only its SHA-256 hash stored), exchanged once for a
  short-lived booking-scoped cookie. Three time-based access tiers
  (manage / view-only / expired). Neutral, rate-limited resend.
- **Reschedule / cancel** — reschedule is a two-slot atomic swap in one
  transaction (claim new, release old, or the whole thing aborts). Cancel
  is one transaction. Both trigger a post-commit waitlist notification and
  customer emails.
- **Waitlist** — FIFO opt-in by service (+ optional provider); the next
  match is notified when a slot is released; notified entries expire after
  15 minutes via a delayed job.
- **Realtime** — Socket.IO `slot:updated` events, tenant rooms resolved
  server-side (staff from the session, public booking page from the
  business slug). No polling.
- **Jobs / notifications** — BullMQ worker: transactional + reminder
  emails (Resend adapter, console stub without keys), recurring weekly
  slot generation, hold-expiry sweep, waitlist expiry.
- **AI no-show scoring** — post-commit background job calls Gemini, writes
  a `noShowRiskNote` visible only to staff. Entirely optional — unset
  `GEMINI_API_KEY` and the job silently no-ops.
- **Frontend** — public booking page with live availability, hold
  countdown, and waitlist fallback; magic-link manage page; owner
  dashboard (settings, services, staff); staff dashboard (bookings list,
  schedule, walk-in, waitlist). A 401 anywhere drops the app to the login
  screen centrally.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite, Tailwind CSS, custom UI primitives |
| Backend | Node.js + Express 4 + TypeScript (ESM, `tsx` in dev) |
| Database | MongoDB (replica set / Atlas — transactions are used throughout) via Mongoose |
| Cache / holds / sessions / rate limits | Redis (Upstash) via ioredis |
| Jobs | BullMQ worker (`npm run worker`) |
| Realtime | Socket.IO |
| AI | Google Gemini (optional) |
| Email | Resend (optional; console stub otherwise) |
| Validation | Zod |
| Monorepo | npm workspaces + Turborepo |

## Repository structure

```
apps/
  api/                     Express + TypeScript backend
    src/
      modules/             auth, tenants, staff, services, resources,
                           providers, availability, slots, bookings,
                           waitlist, realtime, notifications, noshow
                           (model / service / controller / routes per module)
      lib/                 env, db, redis, queue, rateLimit, logger, ...
      middleware/          errorHandler, validate
      routes.ts            router barrel, mounted at /api
      server.ts            HTTP + Socket.IO bootstrap; serves apps/web/dist
      worker.ts            BullMQ job processor
  web/                     React + Vite frontend
    src/features/          auth, tenants, bookings, marketing
packages/
  shared-types/            types shared by api + web
scripts/
  concurrency-demo.mjs     scripted double-booking race (see below)
```

## Prerequisites

- Node.js ≥ 20, npm (`packageManager: npm@11.17.0`)
- A **replica-set** MongoDB (MongoDB Atlas is fine) — single-node
  standalone will not work, the app uses multi-document transactions
- A Redis instance (Upstash's TCP `rediss://` URL, not the REST URL)

## Setup

```bash
npm install                 # installs + links all workspaces
cp .env.example apps/api/.env
# fill in MONGODB_URI, REDIS_URL, SESSION_COOKIE_SECRET
```

`.env` is gitignored — never commit real credentials. Every variable is
documented in [`.env.example`](./.env.example), which also carries a
production checklist. `apps/api/src/lib/env.ts` validates on boot with Zod
and exits immediately if anything required is missing (and refuses to start
in `NODE_ENV=production` with the placeholder `SESSION_COOKIE_SECRET`).

| Required | Purpose |
|---|---|
| `MONGODB_URI` | Replica-set connection string |
| `REDIS_URL` | Sessions, booking holds, rate limiters |
| `SESSION_COOKIE_SECRET` | Session cookie signing — strong & unique in prod |

Optional: `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (real email),
`GEMINI_API_KEY` (no-show scoring), `PORT`, `FRONTEND_URL`,
`SESSION_TTL_SECONDS`, `MAGIC_LINK_TTL_SECONDS`, `GEMINI_MODEL`.

There is **no** frontend API base-URL variable: the web app calls the API
via relative `/api/...` paths — Vite's dev proxy forwards them in dev, and
in production one origin serves both (architecture §14).

## Running locally

Three processes. From the repo root:

```bash
npm run dev                              # api (:4000) + web (:5173) + shared-types, in parallel
npm run dev --workspace=@queueless/api   # API only
npm run worker --workspace=@queueless/api  # BullMQ worker (emails, recurring jobs)
npm run dev --workspace=web              # frontend only (proxies /api to :4000)
```

The worker is a separate process — reminder emails, weekly slot
generation, hold-expiry and waitlist-expiry jobs only run while it's up.

Health check:

```bash
curl http://localhost:4000/health
# {"status":"ok","database":"connected"}   (503 "degraded" if Mongo is down)
```

## Build & deploy

```bash
npm run build      # turbo: tsc for api + shared-types, tsc -b && vite build for web
npm run lint
```

**Deployment is single-origin (architecture §14).** After `npm run build`,
`apps/api` serves `apps/web/dist` for every non-`/api`, non-`/health` path
(with SPA fallback to `index.html`), so the whole app is one process on one
port — no CORS, no `SameSite=None`, no CSRF middleware. Run the compiled
API with `npm run start --workspace=@queueless/api` and the worker as a
sibling process pointed at the same Redis.

Production checklist: `NODE_ENV=production`, a real
`SESSION_COOKIE_SECRET`, replica-set Mongo, `rediss://` Redis, and the web
build present. Behind a reverse proxy the API already trusts one hop of
`X-Forwarded-For` for correct per-IP rate limiting.

## The concurrency demo

The headline guarantee — two clients, one slot, exactly one winner — is
scripted:

```bash
node scripts/concurrency-demo.mjs                       # against http://localhost:4000
node scripts/concurrency-demo.mjs https://your-deploy   # against a deployed instance
```

It signs up a throwaway business, generates slots, then fires N
simultaneous `POST /api/bookings/hold` requests at one capacity-1 bucket
and asserts exactly 1 × `201` + (N−1) × `409 SLOT_NOT_AVAILABLE`, then
repeats on a capacity-2 bucket expecting 2 winners.

## Architecture in one paragraph

A **modular monolith**: one Express app, feature modules that talk only
through each other's exported service functions (never by reaching into
another module's Mongoose model). Correctness rests on atomic
`findOneAndUpdate` conditional writes for single-slot transitions and
multi-document Mongo transactions for anything spanning two (signup,
reschedule, cancel, staff/resource/service cascades). Redis holds a TTL
lock per in-flight checkout, fenced by a `holdVersion` token so a stale
hold can never confirm. Every external side effect (email, realtime emit,
AI scoring) happens strictly *after* the transaction commits. Full detail:
[`queueless-plus-plus-architecture.md`](./queueless-plus-plus-architecture.md).
