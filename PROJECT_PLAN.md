# QueueLess++ — Project Plan & Work Breakdown

Living tracker for how we take this from current state to a demo-ready product. Companion to [queueless-plus-plus-architecture.md](queueless-plus-plus-architecture.md) (the "what and why") — this file is the "who, when, and how we stay out of each other's way."

**Team**
- **Peter 1** — Backend, owns the **Booking Track**
- **Peter 3** — Backend, owns the **Platform Track**
- **Peter 2 (AI)** — All frontend: UI, design, component work, data-fetching, polish — every phase

---

## 0. Where we actually are right now (2026-08-26)

Audited against the actual repo, not assumed:

| Area | Status |
|---|---|
| Monorepo scaffold (turbo, workspaces, `apps/api`, `apps/web`, `packages/shared-types`) | ✅ Done |
| CI workflow (`.github/workflows/ci.yml`) | ✅ Present |
| Mongo connection, env loading, pino logger, error handler middleware | ✅ Done |
| Redis client wired (`ioredis` in deps, `lib/redis.ts`) | ✅ Done |
| CORS, Express server bootstrap | ✅ Done |
| Module folders scaffolded: `auth`, `tenants`, `bookings` | ✅ Folders exist |
| Actual module logic in those folders | ❌ **Stubs only** — `auth.service.ts`, `tenants.service.ts`, `bookings.service.ts` each just `return { name: '<module>' }`. No Mongoose models, no real handlers. |
| `staff`, `services`, `availability`, `waitlist`, `notifications`, `realtime` modules | ❌ Not scaffolded |
| BullMQ, Socket.IO, Gemini AI | ❌ Not installed / not started |
| Frontend: Vite + React + TS + Tailwind + shadcn set up, 5 base components installed | ✅ Done |
| Frontend → API client (`apps/web/src/lib/api.ts`) | ✅ Basic client exists |
| `apps/web/src/features/{auth,bookings,tenants}` | ❌ Empty folders |
| Routing wired into `App.tsx` | ❌ Not done (react-router-dom is installed but unused) |
| `packages/shared-types` | ⚠️ Placeholder only (`User { id, role }`) |

**Bottom line:** infra is real and solid — that's not wasted work, it's the correct foundation. But we're at the very start of Phase 1: zero business logic exists on either side yet.

---

## 1. The independence principle: whole modules, not split files

The architecture doc already gives us the tool we need for conflict-free parallel work — the **modular monolith rule**: *"modules communicate only through their exported service functions, never by reaching into another module's internals."* We're going to lean on that hard for team structure too, not just code structure.

**Rule: each backend module has exactly one owner for its entire lifecycle** — schema, service, controller, routes, tests. The other person never edits inside someone else's module folder. If Track B needs something from Track A's module (e.g., the tenants module needs to check a user's role), it imports A's **exported** function or type — it does not read A's database model directly and does not edit A's files.

This means Peter 1 and Peter 3 are almost never touching the same file, which is what actually prevents merge conflicts (a shared task list with "whoever gets to it" does not).

### Module ownership map

| Track | Owner | Modules |
|---|---|---|
| **Booking Track** — the customer-facing journey: sign in, book, hold, confirm, reschedule, cancel, waitlist, no-show risk | **Peter 1** | `auth`, `bookings`, `waitlist`, AI no-show scoring |
| **Platform Track** — business setup and the plumbing that supports it | **Peter 3** | `tenants`, `staff`, `services`, `availability`, `realtime`, `notifications` |

Why split this way rather than "backend logic vs. infra logic": each track is a coherent story a person can hold in their head end-to-end. Peter 1's track is "what a booking goes through, start to finish." Peter 3's track is "what a business owner sets up, and the machinery that turns that setup into bookable slots and outbound messages." Neither needs to deeply understand the other's internals to build against their exported interface — which is exactly what a real interview answer about module boundaries should sound like.

### The handful of shared touchpoints (and how we keep them low-friction)

These are the only places both of you will edit, so treat them with a little extra care — small commits, pull before you push, and if you do collide it's a one-line rebase, not a real conflict:

1. **`packages/shared-types/src/`** — split into **one file per domain type** (`user.ts`, `business.ts`, `service.ts`, `staffAvailability.ts`, `slot.ts`, `booking.ts`, `waitlistEntry.ts`), each edited only by that type's owning track, with a single `index.ts` barrel that just re-exports. You're each adding a new `export * from './x'` line to `index.ts` on different lines — effectively never conflicts.
2. **`apps/api/src/routes.ts`** (new, to be created in Phase 1 below) — a barrel file where each module exports its own Express router and this file just imports + mounts them. Same shape as (1): each of you adds one import line and one mount line. Keeps `server.ts` itself untouched by either of you after initial setup.
3. **RBAC / businessId-scoping middleware** — lives in `auth` (Peter 1's), exported for Peter 3's routes to apply. Peter 3 imports and uses it, never edits it. If it needs to change, that's a quick message to Peter 1, not a direct edit.
4. **`.env` / `env.ts`** — additive only (new vars appended), practically conflict-free by nature.

---

## 2. Phases

### Phase 1 — Foundation conventions

This is the leftover setup work that the independence principle above depends on. It's small and mostly mechanical, so rather than pairing on all of it, it's split individually below — the only thing that actually needs agreement, not joint work, is the two conventions called out at the bottom, and those are quick to settle async (a message, not a meeting).

**Peter 1**
- [ ] Set up the `packages/shared-types/src/` barrel structure — create `index.ts` re-exporting per-domain files, and create `user.ts` (his own domain going forward)
- [ ] Create `apps/api/src/routes.ts` barrel and wire it into `server.ts` (empty barrel is fine — each track adds its own mount line later)
- [ ] Add JWT env vars (`JWT_SECRET`, `JWT_EXPIRES_IN`) to `env.ts` — needed before real `auth` work starts

**Peter 3**
- [ ] Create `business.ts`, `service.ts`, `staffAvailability.ts` stub files in `shared-types/src/` (his own domains going forward), and add their `export *` lines to Peter 1's `index.ts` barrel
- [ ] Set the Mongoose model convention by example: build out the `tenants` module's folder shape first (`modules/tenants/tenants.model.ts` co-located, not a shared `models/` folder) so Peter 1 can mirror it in `auth`

**Peter 2 (AI)**
- [ ] Set up a typed fetch wrapper in `lib/api.ts` (base URL, error handling, JSON parsing) that both backend tracks' endpoints will plug into once they exist

**Decide async, no meeting needed (drop a message, agree, move on):**
- Response-shape convention (e.g. `{ data }` vs `{ error }` envelope) — needed before Peter 2 builds the fetch wrapper above, so settle this first
- Confirm the model-convention-by-example from Peter 3's `tenants` module works for Peter 1 before both build on it in Phase 2

**Exit criteria:** both backend people can create a new module folder, add a router to `routes.ts`, add a type to `shared-types`, and start writing logic without needing to touch the other's files.

---

### Phase 2 — Foundations: auth, tenant/staff/service setup
**Goal:** a business owner can register, log in, create their business, add services and staff. No booking logic yet.

**Peter 1 — Booking Track**
- [ ] `User` schema + `auth` module: register/login, password hashing, JWT issuance
- [ ] RBAC middleware (owner/staff/customer) + businessId-scoping middleware — exported for Peter 3 to use
- [ ] Publish `User` type to `shared-types/src/user.ts`

**Peter 3 — Platform Track**
- [ ] `Business` schema + `tenants` module: business creation, unique slug routing
- [ ] `Service` schema + `services` module: CRUD, businessId-scoped (uses Peter 1's scoping middleware)
- [ ] `StaffAvailability` schema + `staff` module: staff CRUD + weekly availability template, businessId-scoped
- [ ] Publish `Business`, `Service`, `StaffAvailability` types to their own `shared-types` files

**Peter 2 (AI) — Frontend**
- [ ] Wire up `react-router-dom` in `App.tsx` — route skeleton for public site, auth, and dashboard areas
- [ ] Auth pages: login/register (`features/auth`) using existing shadcn components
- [ ] Owner onboarding flow: create business, add services, add staff (`features/tenants`)
- [ ] Authenticated dashboard shell (nav, business context)
- [ ] Wire all of the above through `lib/api.ts` to real endpoints — no mocks

**Exit criteria:** owner signs up, logs in, creates a business, adds a service and a staff member, sees it in the dashboard — end to end.

---

### Phase 3 — Core booking engine (the interview centerpiece)
**Goal:** atomic booking, holds, and real-time updates.

**Peter 1 — Booking Track**
- [ ] `Booking` schema
- [ ] Real `bookings` module: atomic `findOneAndUpdate` conditional write for hold → confirm (architecture doc §4) — replaces the current stub
- [ ] Redis hold with TTL (`SET hold:slotId sessionId EX 300 NX`) (§5)
- [ ] Calls into Peter 3's `realtime` module's exported emit function on state change — does not touch `realtime` internals
- [ ] `waitlist` module: schema + trigger on slot release (calls into `bookings` exports only)
- [ ] Publish `Booking`, `WaitlistEntry` types

**Peter 3 — Platform Track**
- [ ] `Slot` schema + `availability` module: slot generation from `StaffAvailability` templates
- [ ] Install + wire Socket.IO; `realtime` module owns the gateway, tenant-scoped rooms (`business:${businessId}`), and exports an `emitSlotUpdate()` function for `bookings` to call (§7)
- [ ] Publish `Slot` type

**Peter 2 (AI) — Frontend**
- [ ] Public booking page per business (`/b/:slug`) — service/staff/time selection, slot grid
- [ ] Booking confirmation flow, hold countdown UI (reflects Redis TTL)
- [ ] Socket.IO client integration — live slot updates on booking page + staff dashboard, no refresh
- [ ] Staff dashboard: live bookings list, today's schedule
- [ ] Waitlist opt-in UI when a slot is taken

**Note on the interface between tracks:** `bookings` (Peter 1) needs slots to exist (Peter 3's `availability`) and needs to push updates (Peter 3's `realtime`). Agree on both function signatures *before* writing the implementations — a 10-minute conversation up front here saves a rewrite later. This is the one phase where the two tracks are genuinely coupled, so touch base at the start and again once each side has a working stub.

**Exit criteria:** the "money demo" works — two tabs booking the same slot, one succeeds, one is offered the waitlist instantly via real-time push, no polling.

---

### Phase 4 — Reschedule, cancellation, notifications, AI no-show scoring
**Goal:** complete the state machine, add depth features.

**Peter 1 — Booking Track**
- [ ] Reschedule as a single Mongo transaction — two-slot atomic swap (§4)
- [ ] Cancellation flow (release slot, trigger `waitlist` notify via export)
- [ ] AI no-show scoring: new small module, reads aggregated booking history via `bookings` exports, calls Gemini 1.5 Flash, silent fallback on failure, rate-limited to once per booking creation (§10)

**Peter 3 — Platform Track**
- [ ] Install BullMQ + worker process
- [ ] `notifications` module + jobs: `send-reminder-email`, `process-hold-expiry`, `waitlist-notify`, `generate-weekly-slots` (§6)
- [ ] Email provider integration: confirmation, reminder, cancellation emails (§8)

**Peter 2 (AI) — Frontend**
- [ ] Reschedule flow UI (pick new slot, confirm swap)
- [ ] Cancellation flow UI (customer + staff-initiated)
- [ ] Notification status indicators on staff dashboard (e.g. "reminder sent")
- [ ] No-show risk note on staff-facing booking detail view
- [ ] Waitlist "slot opened up" claim flow (time-boxed)

**Exit criteria:** full state machine reachable through the UI, reminder emails fire on schedule, no-show risk shows for staff.

---

### Phase 5 — Polish & demo prep
**Goal:** presentable, and the pitch from architecture doc §12 is rehearsed.

**Peter 1 — Booking Track**
- [ ] Re-verify RBAC checks on every `bookings`/`auth`/`waitlist` mutating route
- [ ] Script two near-simultaneous booking requests against the deployed instance to confirm the double-booking demo is reliable, not lucky

**Peter 3 — Platform Track**
- [ ] Re-verify RBAC checks on every `tenants`/`staff`/`services` mutating route; add rate limiting on the public booking endpoint
- [ ] Deploy hardening: production Mongo/Redis connection settings, env var checklist

**Peter 2 (AI) — Frontend**
- [ ] Visual polish: consistent spacing/typography, empty/loading/error states across all flows
- [ ] Responsive check
- [ ] Two-tab concurrency demo rehearsed against the deployed instance, not localhost

**Peter 1 + Peter 3 (together, README only)**
- [ ] README rewrite with real setup instructions + architecture diagram

**Everyone**
- [ ] Rehearse the demo script (§12) end-to-end at least twice

**Exit criteria:** double-booking demo and reschedule demo both run cleanly, deployed, rehearsed.

---

### Phase 6 — Stretch (optional, cut without guilt)
Only if Phases 1–5 finish with time to spare.

- [ ] Basic analytics: today's bookings count, no-show rate — simple aggregation + a couple of stat tiles, explicitly **not** a full dashboard system (per the architecture doc's own scoping decision)
- [ ] Anything deferred earlier, prioritized by what strengthens the live demo most

---

## 4. Tracking

Update checkboxes as work lands — this file is the source of truth for "what phase are we in," not a one-time plan.

| Phase | Status | Completed |
|---|---|---|
| Phase 1 — Foundation conventions | 🔴 Not started | — |
| Phase 2 — Foundations (auth/tenant/staff/service) | ⚪ Blocked on Phase 1 | — |
| Phase 3 — Core booking engine | ⚪ Blocked on Phase 2 | — |
| Phase 4 — Reschedule/cancel/notifications/AI | ⚪ Blocked on Phase 3 | — |
| Phase 5 — Polish & demo prep | ⚪ Blocked on Phase 4 | — |
| Phase 6 — Stretch | ⚪ Optional | — |
