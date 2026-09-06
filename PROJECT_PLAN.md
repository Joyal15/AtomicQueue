# QueueLess++ — Project Plan & Work Breakdown

Living tracker for how we take this from current state to a demo-ready product. Companion to [queueless-plus-plus-architecture.md](queueless-plus-plus-architecture.md) (the "what and why") — this file is the "who, when, and how we stay out of each other's way."

**Team**
- **Peter 1** — Backend, owns the **Booking Track**
- **Peter 3** — Backend, owns the **Platform Track**
- **Peter 2 (AI)** — All frontend: UI, design, component work, data-fetching, polish — every phase

---

## 0. Where we actually are right now (2026-08-28)

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

**Bottom line:** infra is real and solid, and — updated from the original audit above — Phase 1's foundation-conventions work is now also done (shared-types barrel including `resource.ts`, the `/api`-mounted routes barrel, session env vars, the `tenants` model-folder convention, and the frontend's typed `{data}`/`{error}` fetch wrapper all verified present in the repo; see Phase 1's checklist below). Zero *business logic* still exists — `auth.service.ts`, `tenants.service.ts`, `bookings.service.ts` remain stubs — that's Phase 2's work, next.

---

## 1. The independence principle: whole modules, not split files

The architecture doc already gives us the tool we need for conflict-free parallel work — the **modular monolith rule**: *"modules communicate only through their exported service functions, never by reaching into another module's internals."* We're going to lean on that hard for team structure too, not just code structure.

**Rule: each backend module has exactly one owner for its entire lifecycle** — schema, service, controller, routes, tests. The other person never edits inside someone else's module folder. If Track B needs something from Track A's module (e.g., the tenants module needs to check a user's role), it imports A's **exported** function or type — it does not read A's database model directly and does not edit A's files.

This means Peter 1 and Peter 3 are almost never touching the same file, which is what actually prevents merge conflicts (a shared task list with "whoever gets to it" does not).

### Module ownership map

| Track | Owner | Modules |
|---|---|---|
| **Booking Track** — the customer-facing journey: sign in, book, hold, confirm, reschedule, cancel, waitlist, no-show risk | **Peter 1** | `auth`, `bookings`, `waitlist`, AI no-show scoring |
| **Platform Track** — business setup and the plumbing that supports it | **Peter 3** | `tenants`, `staff`, `providers`, `services`, `availability`, `realtime`, `notifications` |

Why split this way rather than "backend logic vs. infra logic": each track is a coherent story a person can hold in their head end-to-end. Peter 1's track is "what a booking goes through, start to finish." Peter 3's track is "what a business owner sets up, and the machinery that turns that setup into bookable slots and outbound messages." Neither needs to deeply understand the other's internals to build against their exported interface — which is exactly what a real interview answer about module boundaries should sound like.

### The handful of shared touchpoints (and how we keep them low-friction)

These are the only places both of you will edit, so treat them with a little extra care — small commits, pull before you push, and if you do collide it's a one-line rebase, not a real conflict:

1. **`packages/shared-types/src/`** — split into **one file per domain type** (`user.ts`, `business.ts`, `service.ts`, `resource.ts`, `providerAvailability.ts`, `slot.ts`, `booking.ts`, `waitlistEntry.ts`), each edited only by that type's owning track, with a single `index.ts` barrel that just re-exports. You're each adding a new `export * from './x'` line to `index.ts` on different lines — effectively never conflicts.
2. **`apps/api/src/routes.ts`** (new, to be created in Phase 1 below) — a barrel file where each module exports its own Express router and this file just imports + mounts them. Same shape as (1): each of you adds one import line and one mount line. Keeps `server.ts` itself untouched by either of you after initial setup. Name every route per architecture doc **§13a**'s route reference table — it's the canonical method/path list, not something either track should invent independently.
3. **RBAC / businessId-scoping middleware** — lives in `auth` (Peter 1's), exported for Peter 3's routes to apply. Peter 3 imports and uses it, never edits it. If it needs to change, that's a quick message to Peter 1, not a direct edit.
4. **`.env` / `env.ts`** — additive only (new vars appended), practically conflict-free by nature.
5. **Signup (business + owner creation, architecture doc Section 4d)** — the one operation that genuinely spans both tracks' models in a single transaction. **Peter 1 owns and writes `POST /api/auth/signup`** (architecture doc §13a's route reference — it results in a session, so it lives in `auth`), but the transaction must insert both a `Business` doc and a `User` doc together. Resolve this the same way the module-boundary rule resolves everything else: Peter 3's `tenants` module exports a `createBusinessDoc(data, { session })`-shaped function that accepts an optional Mongoose session and performs the insert using its own model — Peter 1's signup handler opens the `session.withTransaction(...)`, calls that exported function plus its own `User` insert inside it, and neither track ever reaches into the other's model directly. Agree on that function's exact signature before either side builds against it — a 5-minute conversation, not a design meeting.

---

## 2. Phases

### Phase 1 — Foundation conventions

This is the leftover setup work that the independence principle above depends on. It's small and mostly mechanical, so rather than pairing on all of it, it's split individually below — the only thing that actually needs agreement, not joint work, is the two conventions called out at the bottom, and those are quick to settle async (a message, not a meeting).

**Peter 1**
- [x] Set up the `packages/shared-types/src/` barrel structure — create `index.ts` re-exporting per-domain files, and create `user.ts` (his own domain going forward) — *verified in repo: `index.ts` re-exports `user`/`business`/`service`/`resource`/`providerAvailability`; `user.ts` matches the locked `role: 'owner'|'staff'` model*
- [x] Create `apps/api/src/routes.ts` barrel and wire it into `server.ts` **mounted under `/api`** (`app.use('/api', routes)`) — `/health` stays unprefixed, outside this barrel entirely (architecture doc §13a/§14). Empty barrel is fine at this point — each track adds its own mount line later, but the `/api` prefix is established now so nobody has to retrofit it after routes already exist — *verified in repo: `routes.ts` mounts `auth`/`tenants`/`bookings`; `server.ts` does `app.use('/api', routes)`; `/health` is separate and unprefixed*
- [x] Add session/cookie env vars (e.g. `SESSION_COOKIE_SECRET`, `SESSION_TTL_SECONDS`) to `env.ts` — needed before real `auth` work starts. Staff/owner auth is server-side Redis sessions behind an `HttpOnly` cookie, NOT JWT (architecture doc Section 9) — no `JWT_SECRET`/`JWT_EXPIRES_IN` vars are needed. — *verified in repo: both vars present in `env.ts` and `.env.example`, no JWT vars anywhere*

**Peter 3**
- [x] Create `business.ts`, `service.ts`, `resource.ts`, `providerAvailability.ts` stub files in `shared-types/src/` (his own domains going forward), and add their `export *` lines to Peter 1's `index.ts` barrel — `providerAvailability.ts` (not `staffAvailability.ts`) matches the architecture doc's actual model: it's a shared template shape for BOTH staff and resource providers (turf/room/equipment), not staff-only (see architecture doc Section 2/2a) — *verified in repo: all four files present and exported; `resource.ts` was the one missing file, added and wired into the barrel (build verified clean)*
- [x] Set the Mongoose model convention by example: build out the `tenants` module's folder shape first (`modules/tenants/tenants.model.ts` co-located, not a shared `models/` folder) so Peter 1 can mirror it in `auth` — *verified in repo: `modules/tenants/` has `tenants.model.ts` co-located with `.controller.ts`/`.service.ts`/`.routes.ts`/`index.ts` — the example exists. Mirroring it into `auth` itself is Phase 2's `User` schema work, not required to close this item.*

**Peter 2 (AI)**
- [x] Set up a typed fetch wrapper in `lib/api.ts` (base URL, error handling, JSON parsing) that both backend tracks' endpoints will plug into once they exist — *verified in repo: `apps/web/src/lib/api.ts` implements the locked `{data}`/`{error}` contract directly (§13), with relative `/api/...` paths per the same-origin deployment decision (§14) — this already supersedes the original "base URL" framing, correctly*

**Decide async, no meeting needed (drop a message, agree, move on):**
- Response-shape convention — already settled, not open: `{ data }` on success / `{ error: { code, message, ...} }` on failure, per architecture doc Section 13. Peter 2's fetch wrapper should just implement this directly. **✅ Done — implemented, not just agreed.**
- Confirm the model-convention-by-example from Peter 3's `tenants` module works for Peter 1 before both build on it in Phase 2. **⏳ Not verifiable from the repo — this is a conversation between the two of you, not a code artifact. Have it before starting Phase 2's `User` schema, then this is closed.**

**Exit criteria:** both backend people can create a new module folder, add a router to `routes.ts`, add a type to `shared-types`, and start writing logic without needing to touch the other's files. **Met, code-wise** — the one remaining item is the human confirmation step directly above, not a build gap.

---

### Phase 2 — Foundations: auth, tenant/staff/service setup
**Goal:** a business owner can register, log in, create their business, add services and staff. No booking logic yet.

**Status (audited against the repo, 2026-09-03, fifth pass): 🟡 In progress — Peter 3's AND Peter 2's Phase 2 checklists are both now closed.** `authenticate` is exported and mounted on all five of Peter 3's routers. `Business.timezone`/`cancellationCutoffMinutes` landed, plus a real view/update endpoint. `StaffInvitations` is a working send/list/revoke flow with the accept-half (`consumeInvitation`) built and handed off. The frontend is real now too — signup, dashboard, business settings, services, and staff invitations all call live endpoints, gated by a real (if stopgap-bootstrapped) auth context. What's left blocking the exit criteria is entirely Peter 1's: `/login` and `/accept` don't exist server-side yet.

**Peter 1 — Booking Track**
- [~] `User` schema + `auth` module: register/login, bcryptjs (cost 12), Redis-backed session issuance — *verified in repo: `UserModel` matches the architecture schema field-for-field; `signupOwner()` (`auth.service.ts`) is genuinely correct — bcrypt cost 12, the owner `User` + `Business` written in one Mongo transaction via `tenants.createBusiness(input, session)` (shared touchpoint 5, done exactly as specified), bounded slug-collision auto-retry that does NOT retry a duplicate-email failure (architecture §4d, correct distinction); `auth.session.ts`'s `createSession()` mints an opaque `randomBytes(32)` hex ID, stores `{userId, issuedAt}` in Redis with a 7-day TTL, sets the cookie `httpOnly`/`secure`/`sameSite: 'strict'` (§9, correct).* **Missing: `POST /api/auth/login` — only `/signup` and `/status` exist in `auth.routes.ts`.** An owner can be created but can never log back in. "Register" is done; "login" is not.
- [~] Session security details — *verified in repo: `passwordChangedAt` is written in the same `UserModel.create` call as `passwordHash` at signup (§9's "same write" rule, correct so far — there's no password-change endpoint yet to re-verify it against); `authenticate.ts` re-reads `role`/`businessId`/`status` fresh from Mongo on every request and rejects on `status !== 'active'` or a stale `issuedAt` vs. `passwordChangedAt`/`sessionsInvalidatedAt`, exactly per §9; `createSession()` always mints a fresh ID, never reuses a client-supplied one (session-fixation prevention, correct).* **Missing: no "log out everywhere" endpoint** — `sessionsInvalidatedAt` sits on the schema unused, nothing ever stamps it. **Missing: no `/logout` endpoint either** — `deleteSession()` exists in `auth.session.ts` but no route calls it.
- [~] RBAC middleware + businessId-scoping middleware, exported for Peter 3 — *verified in repo, closed since the last pass: `authenticate` is exported from `auth/index.ts` and is now imported and mounted by all four of Peter 3's routers — businessId-scoping is real and working end to end, not just defined.* **Still missing: no owner-vs-staff RBAC (role-check) middleware exists** — not yet required by any built route, but it's a distinct item from businessId-scoping and remains unbuilt. (Peter 3's `providers.service.ts` still reaches into `auth.model.ts`'s `UserModel` directly for a staff listing read — swap that for an `auth`-exported function when one exists, now that the export pattern is proven with `authenticate`.)
- [x] Publish `User` type to `shared-types/src/user.ts` — *verified in repo: `User` and `AuthenticatedUser` both present, shapes match what `auth.session.ts`/`authenticate.ts` actually produce.*

**Peter 3 — Platform Track**
- [x] `Business` schema + `tenants` module: transactional-insert export + unique slug routing — *verified in repo: `BusinessDocument`/shared `Business` type/`createBusiness(input, session)` all carry `timezone`/`cancellationCutoffMinutes`; `Businesses.slug` `unique: true`. `tenants.routes.ts` now also has `GET /` (view own business, owner or staff per §9's visibility rule) and `PATCH /` (owner-only, Zod-validated partial update of `name`/`timezone`/`cancellationCutoffMinutes` — `slug`/`ownerId` deliberately not editable here, no ownership-transfer path per §4d) backed by new `getBusinessById`/`updateBusiness` in `tenants.service.ts`, both exported from the barrel.*
- [x] `Service` schema + `services` module: CRUD, businessId-scoped — *verified in repo: full create/list/get/update/deactivate, every query filtered by `businessId`; now actually reachable end-to-end with `authenticate` mounted.*
- [x] `Resources` schema + CRUD — *verified in repo: full CRUD, `status: 'active'|'removed'`, `capacity`, correct; also now reachable with `authenticate` mounted.* **Location deviates from the plan's own instruction** — this lives in its own `resources/` module rather than the `providers` module the plan names ("don't split it ambiguously across `staff`/`resources`"). Works correctly; flagging as a deliberate-or-not decision to make, not a defect.
- [x] Centralized provider-validation function (`providers` module, §2b) — *verified in repo: `validateProvider()` in `providers.service.ts` checks exists → same-business → active → (staff-only) eligible via a named `isProviderEligibleRole` predicate that correctly includes `owner` (architecture §2/§2a/§2b all say an owner can act as a provider — an earlier version of this file wrongly excluded owners; fixed), wired into `availability.createAvailability` so it's actually enforced, not just defined.*
- [x] `ProviderAvailability` schema + CRUD + weekly template — *verified in repo: schema + full CRUD in `availability/`, `serviceId` validated same-business+active, `providerId`/`providerType` validated via the function above; reachable with `authenticate` mounted.* **Same location deviation as Resources** — lives in `availability/`, not `providers/` as the plan names it.
- [x] `StaffInvitations` schema + invitation send/accept flow — *verified in repo, closed since the last pass: `staffInvitations.model.ts` (schema, matches §9b), `staffInvitations.service.ts` (`createStaffInvitation` — closes architecture §9b's case-1 gap by rejecting an email that already belongs to any `Users` row, active or removed, any business; handles the create-path duplicate-key race with a depth-1 retry; `revokeStaffInvitation` returns a discriminated result distinguishing 404-not-found from 409-not-pending; `getStaffInvitations` list), `staffInvitations.controller.ts` (owner-only create/list/revoke, Zod-validated, Express-4-safe try/catch+`next(error)` since this codebase has no async-error-catching wrapper), mounted in `tenants.routes.ts` under `/api/tenants/invitations`, all exported from `tenants/index.ts`. New shared `lib/requireRole.ts` guard alongside `requireUser`.* **The accept half is a deliberate, correct split, not a gap**: `consumeInvitation(token, session)` is built and exported — the conditional-accept transaction half, mirroring `createBusiness`'s discipline exactly — but creating the resulting `User` is Peter 1's, since `Users` is his collection (same shared-touchpoint shape as signup's `createBusiness`). Signature handed off; his `/accept` endpoint is the one remaining piece, tracked on his side now, not Peter 3's checklist.
- [x] Publish `Business`/`Service`/`Resource`/`ProviderAvailability` types — *verified in repo: all four are now complete and correct — `Business` closed the `timezone`/`cancellationCutoffMinutes` gap along with the schema above.*

**Peter 2 (AI) — Frontend**
- [x] Wire up `react-router-dom` in `App.tsx` — *verified in repo, rebuilt: real route tree — public `/login`/`/signup`, authenticated `/dashboard` (+ nested `services`/`staff`) behind a `RequireAuth` guard, catch-all redirects to whichever of login/dashboard is actually reachable. The old `/admin`/`/:tenantSlug/book` placeholders are gone — public booking is Phase 3 scope, not this.*
- [x] Auth pages: login/register (`features/auth`) — *verified in repo: `SignupPage.tsx` (wired to the real, working `POST /api/auth/signup`) and `LoginPage.tsx` (wired to `POST /api/auth/login` — correct `{email,password}`→`{user,business}` shape, but that route doesn't exist server-side yet; shows a clean error today, will work with zero frontend changes once Peter 1 ships it). `RequireAuth.tsx` is the route guard.*
- [x] Owner onboarding flow: create business, add services, add staff (`features/tenants`) — *verified in repo: signup itself creates the business (architecture §4d — there's no separate "create business" step by design); `ServicesPage.tsx` (list/create/deactivate, real `/api/services`) and `StaffPage.tsx` (list/invite/revoke, real `/api/tenants/invitations` — since there's no email delivery yet, the create-invite response's raw token is surfaced directly in the UI so an invite is actually usable today) both real, owner-gated where the API is.*
- [x] Authenticated dashboard shell (nav, business context) — *verified in repo: `DashboardLayout.tsx` — real business name from context, active-state nav, sign-out. `lib/auth-context.tsx`'s `AuthProvider` is real session state, not a mock — bootstraps via `GET /api/tenants` (the closest thing to a "who am I" check that exists, since there's no `/api/auth/me`; documented as a stopgap in-code) and caches the signup/login response's user snapshot in `sessionStorage` for display across a refresh (the actual credential stays the `HttpOnly` cookie regardless).* `DashboardOverviewPage.tsx` added too — view/edit business settings via the real `GET`/`PATCH /api/tenants`.
- [x] Wire all of the above through `lib/api.ts` to real endpoints — *verified in repo: every page above calls `apiFetch` against a real, working Peter-3-owned endpoint (signup, tenants view/update, services CRUD, invitations CRUD) — the only unwired call is login, and only because the server route doesn't exist yet, not because the frontend skipped it.*
- Also fixed along the way: `tailwind.config.js` had zero theme tokens, so every existing shadcn-style component (`Button`/`Card`/`Input`) was referencing `bg-primary`/`bg-card`/`border-input`/etc. that resolved to nothing — components were rendering fully unstyled. Added the standard color/radius token mapping + the CSS custom properties in `index.css` (light theme only, nothing in this app switches themes). Verified visually via a dev-server screenshot, not just by the build passing.

**Exit criteria:** owner signs up, logs in, creates a business, adds a service and a staff member, sees it in the dashboard — end to end. **✅ Met (verified 2026-09-06 against live Mongo/Redis):** signup → login → create service → invite staff → open the `/accept` link → set password → staff logs in → GET `/api/tenants` 200. `/login` and `/staff/invitations/:token/accept` both exist, both Zod-validated (malformed body → 400, not 500).

---

### Phase 3 — Core booking engine (the interview centerpiece)
**Goal:** atomic booking, holds, and real-time updates.

**Peter 1 — Booking Track** — *audit 2026-09-06: all verified end-to-end against live Mongo + Redis.*
- [x] `Booking` schema — *`bookings.model.ts`: partial-unique `{businessId,slotId}` on `status:'confirmed'`, partial-unique `accessTokenHash` on `$exists`, `createdBy` nullable.*
- [x] Real `bookings` module: atomic `findOneAndUpdate` conditional write for hold → confirm (§4) — *`claimSlot` (available→held + fresh `holdVersion`) → Redis `SET NX` → `confirmHeldSlot` (`{status:'held',holdVersion}` fenced) + `Booking` insert in one txn; every side effect strictly post-commit. Concurrency verified: 3 concurrent anon holds on a capacity-2 bucket → exactly 2×201, 1×409; capacity-1 → 1×201, 1×409.*
- [x] Staff/owner walk-in booking (§3) — *`POST /api/bookings/walk-in` → `confirmAvailableSlot` (`available → confirmed` direct, no `held`, no txn), `createdBy` = acting user. Verified: `createdBy` set, status `confirmed`.*
- [x] Redis hold with TTL + claim-triggered lazy release (§4/§5) — *`SET hold:<slotId> {sessionId,holdVersion} EX 300 NX`; on `SLOT_HELD`, checks Redis for the observed `holdVersion` and does a fenced `releaseHeldSlot` + retry.*
- [x] Calls into `realtime`'s exported emit on state change — *`emitSlotUpdate` / `emitBookingConfirmationUpdate` via `slots` exports, always post-commit.*
- [x] `waitlist` module: schema + trigger on slot release — *`notifyNextWaitlistEntry` fired post-commit from cancel / reschedule-release / lazy-release; FIFO match by service (+ optional provider); `markWaitlistEntryNotified` schedules the delayed `waitlist-expire-check`.*
- [x] **Customer magic-link flow (§9a)** — *raw `randomBytes(32)` base64url token, only `SHA-256` hash stored; `POST /api/bookings/magic-link/exchange` → 1-hour `booking_access` cookie; every view/cancel/reschedule re-verifies the token and routes through the shared `cancelBooking()`/`rescheduleBooking()`; three tiers enforced live (verified: `manage` >1 day out, `view-only` inside the 60-min cutoff); resend is neutral-response + IP/contact rate-limited, soonest-booking default. **Fixed this audit:** `accessTokenExpiresAt` was `now + 1h` — now `slot.datetime + 7 days` (§9a), and recomputed against the new slot on reschedule (verified `2026-09-13T08:30` for an `08:30` slot).*
- [x] Publish `Booking`, `WaitlistEntry` types — *present in `shared-types/src/`.*
- **Built this audit:** anonymous `POST /api/bookings/hold` + `POST /api/bookings/confirm` (§13a) — the customer-facing hold/confirm path that did not exist (only the authenticated `POST /api/bookings` stand-in did). Slug→businessId resolved server-side; `sessionId` in the body fences the Redis hold; confirm re-resolves the held unit by matching the fenced Redis hold to the (provider, datetime, service) bucket (client never knows a `slotId`, §4b). Zod-validated, wired into `PublicBookingPage`.

**Peter 3 — Platform Track** — *audit 2026-09-06: verified.*
- [x] `Slot` schema + `availability` generation — *DST-aware (Luxon) local→UTC; one `Slot` per capacity unit with `unitIndex`; unique `{businessId,providerId,providerType,datetime,unitIndex}`; idempotent (skips existing tuples); pre+post active-check with conditional compensating delete (§6). Verified: 624 slots from a capacity-2 template.*
- [x] Socket.IO + `realtime` gateway, tenant rooms `business:${businessId}` — *room resolved server-side from the session at handshake/reconnect (§7/§9). **Extended this audit:** an anonymous public-booking-page connection with no session may join a room by supplying the business's **public slug** in the handshake auth (resolved server-side to a businessId — the client still never names a room/businessId); `slot:updated` payloads carry no non-public fields.*
- [x] Manual slot blocking (§3) — *`PATCH /api/slots/:id/block`, atomic `{_id,status:'available'} → 'blocked'`, `blocked` terminal.*
- [x] Publish `Slot` type — *present.*

**Peter 2 (AI) — Frontend** — *audit 2026-09-06: rebuilt.*
- [x] Public booking page (`/b/:slug`) — *`PublicBookingPage.tsx`: live day-grouped time-chip grid, per-bucket capacity badges, **real claim flow** — click a time → `POST /bookings/hold` → hold dialog → contact form → `POST /bookings/confirm` → confirmed screen with a manage link; a lost race (409) opens the waitlist instead. Bucket `remaining` counts update live over Socket.IO, no polling.*
- [x] Booking confirmation flow + hold countdown UI (reflects Redis TTL) — *`BookingDialog` shows a live m:ss countdown to the Redis hold's `heldUntil`; disables confirm on expiry.*
- [x] Customer magic-link manage page (§9a) — *`MagicLinkManagePage.tsx`: token exchanged from the URL then scrubbed; access tiers respected; cancel + reschedule wired (`/bookings/manage/cancel|reschedule`, reschedule via public availability + the `businessSlug` on the manage response).*
- [x] Socket.IO client integration — *`lib/realtime.ts`'s `useSlotUpdates(onUpdate, slug?)` — staff pages use the session, `PublicBookingPage` passes the slug.*
- [x] Staff dashboard: live bookings list, today's schedule — *`StaffBookingsPage.tsx` + `SchedulePage.tsx`, both live.*
- [x] Staff-facing walk-in form (§3) — *`WalkInBookingPage.tsx` → `POST /api/bookings/walk-in` (was pointed at the authenticated hold path; repointed this audit, stale access-token UI removed).*
- [x] Waitlist opt-in UI — *`Dialog` on `PublicBookingPage.tsx`; staff read view on `StaffWaitlistPage.tsx`.*
- **Also built this audit:** `AcceptInvitePage` at `/accept?token=` — the staff-invitation acceptance UI (backend `POST /api/staff/invitations/:token/accept` was ready but unreachable). `StaffPage` now surfaces the full accept link.

**Note on the interface between tracks:** `bookings` (Peter 1) needs slots to exist (Peter 3's `availability`) and needs to push updates (Peter 3's `realtime`). Agree on both function signatures *before* writing the implementations — a 10-minute conversation up front here saves a rewrite later. This is the one phase where the two tracks are genuinely coupled, so touch base at the start and again once each side has a working stub.

**Exit criteria:** the "money demo" works — two tabs booking the same slot, one succeeds, one is offered the waitlist instantly via real-time push, no polling. **✅ Met (verified 2026-09-06):** concurrent anonymous `POST /api/bookings/hold` requests race on `Slot.findOneAndUpdate({status:'available'})` — 3 racers on a capacity-2 bucket → exactly 2×`201` + 1×`409 SLOT_NOT_AVAILABLE`; capacity-1 → 1 win / 1 loss. The loser's client opens the waitlist dialog; `PublicBookingPage` patches every bucket's `remaining` from the `slot:updated` Socket.IO event (anonymous connections join the tenant room via the public slug), no polling.

---

### Phase 4 — Reschedule, cancellation, notifications, AI no-show scoring
**Goal:** complete the state machine, add depth features.

**Peter 1 — Booking Track** — *audit 2026-09-06: verified end-to-end.*
- [x] Reschedule as a single Mongo transaction — two-slot atomic swap (§4) — *`rescheduleConfirmedSlots` claims the new slot + releases the old, both on the caller's `session`; throws → whole txn aborts, original booking untouched. Verified staff + customer paths. **Fixed this audit:** `serviceId` for the new-slot match is now read from the booking's own slot, never trusted from caller input (§3/§4 "same serviceId only") — a bogus caller `serviceId` no longer switches the customer's service. Also: the internal `customer` field is stripped from the reschedule response (§13 allowlist).*
- [x] Cancellation flow — *`cancelBooking` in one txn (status→`cancelled` + `cancelConfirmedSlot`), `notifyNextWaitlistEntry` + cancellation email post-commit. Customer-and-staff race resolves on `status:'confirmed'` filter.*
- [x] Mark `completed` / `no-show` (§3) — *`POST /api/bookings/:id/outcome`, staff/owner-only, conditional on `status:'confirmed'`; verified 200 then 409 on a terminal booking.*
- [x] `waitlist-expire-check` — *`expireWaitlistEntry` (`notified`→`expired`) dispatched by `worker.ts`; scheduled as a delayed job by `markWaitlistEntryNotified`.*
- [x] AI no-show scoring: new small module, **enqueued as a background job strictly after the booking-confirmation transaction commits** (same post-commit pattern as notifications — the confirm response must never wait on Gemini), reads aggregated booking history via `bookings` exports, calls Gemini 1.5 Flash, silent fallback on failure, rate-limited to once per booking creation, never recomputed on reschedule (§10) — *built: `modules/noshow/` (`gemini.client.ts` — dependency-free `fetch` to `generativelanguage.googleapis.com`, 10s timeout, every failure path → `null`; `noshow.service.ts` — `enqueueNoShowScoring()` producer + `runNoShowScoringJob()` handler). Enqueued fire-and-forget post-commit in BOTH `confirmBooking` and `createWalkInBooking` (§10 "self-service and walk-ins alike"); `worker.ts` dispatches `score-no-show-risk` with `removeOnComplete`/`removeOnFail` both set (no retry/backfill). The module never touches `BookingModel` — three new `bookings.service.ts` exports it calls instead: `getBookingScoringContext`, `getCustomerBookingStats` (contact-matched, `businessId`-scoped, no cross-tenant resolution), `persistNoShowRiskNote` (conditional `{_id, noShowRiskNote: null}` write — compute-once, no `status` re-check per §10). `GEMINI_API_KEY`/`GEMINI_MODEL` added to `env.ts`, both optional — unset disables scoring silently. Also fixed here: `getBookingForCustomer` was leaking `noShowRiskNote` into the customer/magic-link payload — now omitted at the serialization layer (§10/§13). Full turbo build verified clean.*

**Peter 3 — Platform Track** — *audit 2026-09-06: verified.*
- [x] Install BullMQ + worker process — *`lib/queue.ts` (dedicated `maxRetriesPerRequest:null` connection) + `worker.ts` (`npm run worker`); recurring `generate-weekly-slots` (daily) and `process-hold-expiry` (every minute) via `upsertJobScheduler`.*
- [x] `notifications` module + jobs — *`send-transactional-email` (`removeOnComplete` + `removeOnFail` both set — token-carrying), `send-reminder-email`, `process-hold-expiry`, `waitlist-expire-check`, `generate-weekly-slots` all handled in `worker.ts`. **Wired this audit:** `confirmBooking` / `createWalkInBooking` / `cancelBooking` / `rescheduleBooking` now actually enqueue the confirmation / cancellation / reschedule emails + 24h/1h reminders post-commit (`enqueueBookingEmails`, email-contact only per §9a, best-effort — the producers existed but nothing called them).*
- [x] Email provider integration (§8) — *`notifications.service.ts`: Resend adapter when `RESEND_*` set, console-log dev stub otherwise.*
- [x] Staff removal + reactivation (§9b) — *`removeStaffMember`: one txn — `Users.status→'removed'` (+ `sessionsInvalidatedAt` stamped), `ProviderAvailability` hard-deleted, future `available`/`held` slots cancelled (`holdVersion` cleared); confirmed left untouched; realtime emits post-commit. Reactivation non-cascading, doesn't touch `passwordHash`. Sole-owner unreachable (filter `role:'staff'`).*
- [x] Resource retirement + reactivation (§9c) — *`retireResource` — identical cascade via the shared `bulkTransitionFutureSlots`.*
- [x] Service deactivation + reactivation (§2c) — *`deactivateService` — one txn: `ProviderAvailability` deleted, future `available`→`blocked` / `held`→`cancelled`, `isActive→false`; reactivation resurrects nothing. **Verified this audit:** after deactivate, an anonymous `POST /bookings/hold` for that service returns 409 — the claim-time `Services.isActive` re-check (§2c "the claim path both defensively re-check") **was missing and is now added** to `claimSlot`, `confirmAvailableSlot`, and the reschedule new-slot lookup.*

**Peter 2 (AI) — Frontend** — *audit 2026-09-06.*
- [x] Reschedule flow UI — *`RescheduleDialog` in `StaffBookingsPage.tsx` and `MagicLinkManagePage.tsx`.*
- [x] Cancellation flow UI (customer + staff) — *`CancelDialog` on both, each behind a confirm.*
- [x] Mark completed / no-show controls (§3) — *expandable row in `StaffBookingsPage.tsx`, confirmed-only.*
- [x] Manual slot-blocking + Service active/inactive toggle (§3/§2c) — *`SchedulePage.tsx` Block; `ServicesPage.tsx` deactivate/reactivate.*
- [ ] Notification status indicators (e.g. "reminder sent") — *not built: the API logs delivery status (§8) but exposes no per-booking delivery field; accepted MVP gap.*
- [x] No-show risk note on the staff booking-detail view — *badge + full text in `StaffBookingsPage.tsx`, staff tier only.*
- [~] Waitlist "slot opened up" claim flow (time-boxed) — *the customer re-claims through the ordinary public atomic path (§6: waitlist-notify is advisory, "not an exclusive claim... claims through the exact same public atomic mechanism as anyone else"); the rebuilt `PublicBookingPage` now provides that path. A dedicated one-click "claim the slot I was notified about" screen is not built — it would need a customer↔entry link the anonymous model deliberately doesn't have (§6).*

**Design pass (pulled forward from Phase 5):** new token palette (indigo primary, success/warning roles, alpha-aware colours so opacity modifiers actually apply), Inter webfont, shadow scale. New primitives: `Select`, `Dialog` (dependency-free portal), `Skeleton`/`SkeletonList`, `Spinner`, `EmptyState`, `PageHeader`, `brand` wordmark, `lib/format.ts` (shared date/price formatters + status→badge maps). New marketing `LandingPage` at `/`; auth pages rebuilt on a two-column `AuthShell`; `DashboardLayout` is now a responsive sidebar + mobile slide-over. Every dashboard/public page moved onto the shared primitives with real loading/empty/error states. Full `turbo run build` clean; landing/login/signup verified in a browser at desktop + mobile widths.

**Exit criteria:** full state machine reachable through the UI, reminder emails fire on schedule, no-show risk shows for staff.

---

### Phase 5 — Polish & demo prep
**Goal:** presentable, and the pitch from architecture doc §12 is rehearsed.

**Peter 1 — Booking Track**
- [ ] Re-verify RBAC checks on every `bookings`/`auth`/`waitlist` mutating route, **and** that every response is built from the allowlist projection, never a raw document — `passwordHash`, `accessTokenHash`, `holdVersion`, session identifiers must never appear in any `bookings`/`auth` response at any tier; cross-tenant or cross-customer resource access returns 404, never 403 (architecture doc §13)
- [ ] Login rate limiting (`auth` module, architecture doc §9): independent per-account (5 failures → 15-minute lockout, reset only by that account's own success) and per-IP Redis-backed limiters, atomic increment+check+lockout as one Redis operation. Nonexistent-account logins still run `bcrypt.compare()` against a fixed dummy hash (timing-enumeration resistance). Redis unreachable → fail closed (500), not silently disabled.
- [ ] Script two near-simultaneous booking requests against the deployed instance to confirm the double-booking demo is reliable, not lucky

**Peter 3 — Platform Track**
- [ ] Re-verify RBAC checks on every `tenants`/`staff`/`services` mutating route, **and** the same response-projection/cross-principal-404 discipline as Peter 1's bullet above, for `tenants`/`staff`/`services`/`resources` responses; add rate limiting on the public booking endpoint
- [ ] Deploy hardening: production Mongo/Redis connection settings, env var checklist
- [ ] Wire Express to serve the built frontend (`apps/web/dist`) from the same origin as the API (architecture doc §14) — this is the actual implementation of the same-origin deployment decision, not just config: mount the frontend's static build behind the API's `/api` prefix so both are served by one process/port. This is what makes "no CORS, no CSRF middleware for MVP" true in practice, not just on paper.

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
| Phase 1 — Foundation conventions | ✅ Done | 2026-08-28 |
| Phase 2 — Foundations (auth/tenant/staff/service) | ✅ Done — `/login` + `/accept` (incl. an `/accept` UI) both shipped and verified; signup→login→business→service→invite→accept→staff-login all pass against live Mongo/Redis | 2026-09-06 |
| Phase 3 — Core booking engine | ✅ Done — anonymous hold/confirm built, money demo verified (3 concurrent holds on a capacity-2 bucket → 2×201, 1×409; capacity-1 → 1 win / 1 loss), live bucket updates over Socket.IO with no polling | 2026-09-06 |
| Phase 4 — Reschedule/cancel/notifications/AI | ✅ Done — reschedule/cancel/outcome verified end-to-end; email + reminder job triggers wired; removal/retirement/deactivation cascades verified; AI no-show module present. Not built (deliberate MVP gaps): notification-status UI, one-click waitlist-claim screen. | 2026-09-06 |
| Phase 5 — Polish & demo prep | 🟡 Partially pulled forward (design system, responsive shell). Remaining: login rate-limit lockout hardening, static-frontend-from-API serving, deploy hardening, rehearsal | — |
| Phase 6 — Stretch | ⚪ Optional | — |
