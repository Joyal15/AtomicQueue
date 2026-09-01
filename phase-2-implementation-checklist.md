# QueueLess++ — Phase 2 Implementation Contract

Consolidated from `queueless-plus-plus-architecture.md`, which is the **single source of truth**. This is a task checklist, not a spec — every item below is a pointer to a decision fully defined in the architecture doc; nothing here is restated in enough detail to drift out of sync with it. If anything here ever appears to conflict with the architecture document, the architecture document wins — treat that as a bug in this file, not an ambiguity to resolve locally.

Organized by workstream for parallel work across three people, not by the doc's week-by-week phase table — several of these span what the phase table calls "Phase 1" and "Phase 2."

---

## Workstream A — Tenancy, Identity, Staff Lifecycle

**Business creation**
- [ ] Pre-generate `userId` and `businessId` as ObjectIds before any write
- [ ] Create `Business` + owner `User` in **one Mongo transaction** — both or neither
- [ ] Slug auto-generated (kebab-case from business name), numeric-suffix fallback on collision (`mikes-barbershop-2`)
- [ ] Pre-validate email/slug before attempting writes (UX only) — the transaction + unique indexes are the actual correctness guarantee, not the pre-check
- [ ] On a genuine concurrent slug collision at commit time, automatically retry with a new candidate slug (bounded retry count) — never auto-retry a duplicate-*email* collision, that's a real "already registered" error (Section 4d)
- [ ] Session issuance and any side effects (welcome email) fire **only after commit**
- [ ] No ownership-transfer flow — `Business.ownerId` is fixed at creation
- [ ] Exactly one `owner` `User` per business, fixed at creation — no path ever creates a second owner or removes/deactivates the sole owner (Section 9)

**Users**
- [ ] `email` unique, **normalized** (lowercase + trim) before storage and before every comparison — same normalization function used everywhere email is a key, **including login**, not just signup/lookup
- [ ] `businessId` is a single ref — no multi-business membership model
- [ ] `status: 'active' | 'removed'` — two states only, no `suspended`
- [ ] `role: 'owner' | 'staff'` **only** — no `'customer'` value; customers never get a `Users` document at all (Section 2/9). Immutable after creation for MVP — no role-change feature
- [ ] `passwordHash` (bcryptjs, cost 12) and `passwordChangedAt` written in the **same** document update, never two separate writes (Section 9)
- [ ] `sessionsInvalidatedAt` (nullable) — set only by an explicit "log out everywhere" action, independent of `passwordChangedAt`, same comparison logic (Section 9)
- [ ] Staff accounts are never self-registered and never owner-set-password — created only via invitation acceptance (Section 9b)
- [ ] Staff lifecycle actions (invite/remove/reactivate) are **owner-only** — no delegated "manager" tier for MVP (Section 9)

**Staff/owner authentication: server-side Redis sessions, NOT JWT (Section 9)**
- [ ] Opaque, cryptographically random session ID in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; session record lives in Redis, keyed by that ID. `Strict` (not `Lax`) since same-origin deployment (Section 14) means the cookie never needs to survive a cross-site top-level navigation, and it matches the customer magic-link cookie's policy (Section 9a) — one consistent rule, not two
- [ ] Redis session stores **only** `userId` + `issuedAt` — never a cached `role`/`businessId`/`status`
- [ ] Every authenticated request resolves the session, then reads `role`/`businessId`/`status` **fresh from Mongo** by `_id` — never trusted from the session record
- [ ] Request rejected if `status !== 'active'`, or if `issuedAt` predates `passwordChangedAt` **or** `sessionsInvalidatedAt` (either alone invalidates)
- [ ] Login always mints a **fresh** session ID — never reuses/extends a pre-existing cookie value (session-fixation prevention)
- [ ] TTL: 7-day **sliding** idle timeout, refreshed only by authenticated HTTP activity — an open tab or live Socket.IO connection alone does **not** refresh it; no absolute cap for MVP
- [ ] Multiple concurrent sessions per user allowed — no single-session enforcement, no reverse index of a user's sessions
- [ ] Logout deletes the Redis session; "log out everywhere" stamps `sessionsInvalidatedAt` (invalidates the triggering session too — frontend redirects to login on success, no further authenticated call on that session)
- [ ] An already-open Socket.IO connection is **not** force-disconnected by logout/"log out everywhere"/removal — revalidated only at next handshake/reconnect (accepted, named MVP limitation)
- [ ] Login rate limiting: independent per-account (5 failures → 15min lockout, reset only by that account's own success) **and** per-IP (separate, more generous threshold/TTL) Redis counters — increment+threshold+lockout as **one atomic** Redis operation, never check-then-increment. Never permanently locks. Login against a nonexistent account still runs `bcrypt.compare()` against a fixed dummy hash (timing-enumeration resistance). Redis unreachable → fail closed (`500`), never silently disabled
- [ ] Socket.IO authenticates via the same session cookie at handshake/reconnect; channel/room membership always resolved **server-side** from the authenticated session, never from a client-supplied businessId/customerId/bookingId/roomId

**Staff invitations, removal, reactivation — see Section 9b of the architecture doc for the complete, authoritative lifecycle.** Checklist form:
- [ ] `StaffInvitations` collection + fields + `{businessId, email}` unique index (Section 9b)
- [ ] Token model matches Section 9a's magic link (`crypto.randomBytes(32)` → SHA-256 hash, one-time, rotated on resend)
- [ ] Email normalization (lowercase + trim) applied identically everywhere email is a key — `Users.email`, `StaffInvitations.email`, all lookups
- [ ] The three invite-time collision cases handled exactly as specified (existing-User rejection with no reactivation exception; pending/expired/revoked = resend; accepted = rejection, not resend)
- [ ] Resend valid from `pending`/`expired`/`revoked` only, never `accepted`
- [ ] Acceptance transaction: **first** conditionally mark the invitation accepted (`status: 'pending' AND expiresAt > now AND tokenHash` match), **then** create the `User` only if that succeeds — `Users.email`'s unique index is the final backstop against a concurrent same-email race, and cleanly aborts the whole transaction if hit
- [ ] Lazy expiry, owner revocation
- [ ] Removal: soft (`Users.status → 'removed'`), one transaction covering `Users.status` + `ProviderAvailability` deactivation + future **`available` AND `held`** `Slots` cancelled (`holdVersion` cleared on the held ones); confirmed future bookings untouched — but remain fully viewable/cancellable/reschedulable/markable regardless of the provider's status (Section 9b)
- [ ] Reactivation: distinct explicit owner action, never implicit; does **not** reset `passwordHash` (named MVP tradeoff) and does **not** restore `ProviderAvailability`

---

## Workstream B — Providers, Availability, Slots, Services

- [ ] No `Providers` collection — `providerId` + `providerType` (`'staff' | 'resource'`) is a polymorphic reference resolving to `Users` or `Resources`
- [ ] Owner can be referenced directly as `providerId`/`providerType: 'staff'` — no separate account required
- [ ] `Resources` collection: `businessId, name, type, capacity` (default 1), `status: 'active' | 'removed'` — interchangeable anonymous units unless individually named as separate rows. Capacity changes only affect **future** generation runs — already-generated slots for near-term dates keep whatever unitIndex range was in effect when created, in either direction; no retroactive regeneration exists (named limitation, not a bug)
- [ ] **Resource retirement (Section 9c) deliberately mirrors staff removal (Section 9b) field-for-field** — same two states, same one-transaction cascade (`Resources.status → 'removed'`, `ProviderAvailability` deactivated, future `available`/`held` Slots cancelled with `holdVersion` cleared), same "confirmed bookings untouched, surfaced as manual follow-up" rule, same reactivation semantics (explicit owner action, does not restore `ProviderAvailability`). Not a separate design — verify it reuses the same mechanism, not a parallel one
- [ ] `ProviderAvailability` requires `serviceId` — multi-service providers need separate, non-overlapping template rows (owner's manual responsibility, not system-enforced — known MVP limitation)
- [ ] `ProviderAvailability` is a generation **template**, not a live schedule — edits are in-place and affect only **future** `generate-weekly-slots` runs; already-generated Slots are never retroactively reconciled, resized, or deleted on a template edit (Section 2)
- [ ] `Slots.durationMinutes` — snapshotted from `Service.durationMinutes` **once, at generation time**, never updated again. The one deliberate exception to this project's "no snapshot, live resolution" rule (`Service.name`/`price` stay live-resolved everywhere) — duration already has a physical consequence baked into a generated Slot the moment it exists. Unaffected by reschedule, service deactivation/reactivation, or historical display; reminders/AI read this field, never `Service.durationMinutes` directly (Section 2)
- [ ] **Centralized provider-validation function**, one call site (`providers` module), used by every write path that sets/changes `providerId`/`providerType`. Verifies, in order: (1) referenced document exists, (2) type matches, (3) belongs to caller's `businessId`, (4) if staff, is **eligible to act as a provider** (`role in {staff, owner}` and `status === 'active'`), (5) referenced `Service.isActive` — kept conceptually separate from raw RBAC
- [ ] **Service lifecycle (Section 2c, new):** `Services.isActive: true → false` is one transaction — `available` Slots → `blocked`, `held` Slots → `cancelled` (holdVersion cleared), `confirmed` Slots untouched, `ProviderAvailability` for that service deactivated. Generation and claim-time both defensively exclude inactive services. Reactivation does not resurrect blocked/cancelled Slots or restore `ProviderAvailability` — mirrors staff/resource reactivation exactly
- [ ] `Slots.status`: `'available' | 'held' | 'confirmed' | 'cancelled' | 'blocked'` — **`completed`/`no-show` are Booking-only, not Slot states** (Section 2/3)
- [ ] `Slots.holdVersion` (nullable, fencing/version token, not a credential): regenerated on every `available → held`; non-null iff `status === 'held'`; cleared to `null` on every `held → X` transition (Section 4)
- [ ] `Slots.unitIndex`: `0` for staff, `0..capacity-1` for resource units
- [ ] Unique index: `{businessId, providerId, providerType, datetime, unitIndex}` — data-integrity backstop. `serviceId` deliberately excluded; `providerType` deliberately kept (defense-in-depth, not strictly required given ObjectId uniqueness — Section 2b)
- [ ] Non-unique index: `{businessId, providerId, providerType, datetime, status}` — claim-query performance. Partial index `{status: 'held'}` — sweep query (Section 6). See Section 2b for the full index/purpose table
- [ ] **A booking has exactly one provider, always** — multi-provider bookings are explicitly out of scope
- [ ] `generate-weekly-slots`: idempotent on `(providerId, datetime, unitIndex)`; always inserts `status: 'available'` only; pre-check **and** post-check provider/service active status per provider, with a **conditional** compensating delete (`{ _id, status: 'available' }`) if it changed mid-run — never an unconditional delete by `_id` (Section 6). This narrows but does not eliminate the generation-vs-removal race — accepted, named residual risk
- [ ] `ProviderAvailability.startTime/endTime` are **local wall-clock time** (`Business.timezone`) — converted to a UTC `Slot.datetime` at generation time via a DST-aware library, never fixed-offset arithmetic (Section 2/6)
- [ ] `Bookings.accessTokenHash`'s unique index **must be sparse/partial** — a plain unique index breaks on the second phone-only booking, since Mongo treats two documents both missing the field as a collision (Section 2)

---

## Workstream C — Booking Engine (core correctness)

- [ ] **Slot state machine:** `available → {held | confirmed | blocked | cancelled}`, `held → {confirmed | available | cancelled}`, `confirmed → {available | cancelled}` — `blocked` and `cancelled` both terminal. Full legal/illegal transition table in Section 3. No payment step — `held → confirmed` is immediate (Section 4a)
- [ ] **Booking state machine:** `confirmed → {cancelled | completed | no-show}`, all terminal. Customer cancel/reschedule cutoff-gated; staff/owner cancel exempt from cutoff; only staff/owner can mark completed/no-show, manual, no automatic detection. Full actor table in Section 3
- [ ] Cutoff checked once, live, immediately before the operation (a time-based rule, not a concurrency guard); the actual concurrency safety comes from conditioning the mutation on `Booking.status: 'confirmed'`
- [ ] **Hold confirmation is gated on `holdVersion` matching the specific hold, not just `status: 'held'`** — this is what closes the Redis/Mongo staleness race (Section 4), not timing/ordering. Redis check (sessionId match, authorization only) happens immediately before the transaction, never inside it
- [ ] Reschedule constrained to the **same `serviceId`** as the original booking; old slot's release routes through the same shared provider/service-active-aware function a plain cancel uses (`available` or `cancelled`, never assumed `available`)
- [ ] `Bookings.slotId` is a **partial unique index** — `{businessId, slotId}` unique, `partialFilterExpression: {status:'confirmed'}` — never a plain unique index, since a Slot is reused across its lifetime and multiple historical Bookings legitimately share a `slotId` (Section 2b)
- [ ] Reschedule's identity is always `bookingId`, never `slotId` — `oldSlotId`/`originalServiceId` are read from the identified Booking. Booking-update filter is `{_id: bookingId, slotId: oldSlotId, status:'confirmed'}`, never bare `{slotId: oldSlotId}`. New-slot claim filter includes `businessId: callerBusinessId` (Section 4)
- [ ] Plain booking claim: single-document atomic `findOneAndUpdate` on `{..., status: 'available'}` → `held`, setting a fresh `holdVersion` — no transaction, this is the hot path
- [ ] **Capacity-aware claiming**: claim by `(businessId, providerId, providerType, datetime, serviceId, status: 'available')`, never by a specific `slotId` — works identically for staff (implicit capacity 1) and resources (capacity N)
- [ ] Reschedule: **one Mongo transaction** touching old slot, new slot, and Booking; waitlist-notify fires after commit, only if the old slot became `available`
- [ ] **Transaction boundary rule (Section 4e):** a transaction is required only where two or more documents must succeed or fail together as one logical unit — not for every multi-document *operation* (e.g. `generate-weekly-slots`'s independent inserts are never wrapped in one transaction). No transaction ever contains an external call (Redis/BullMQ/email/Socket.IO/HTTP) — those always happen strictly after commit
- [ ] `sessionId` = client-generated UUID in `localStorage`, sent with hold/booking requests — not an identity, purely which browser tab holds the slot
- [ ] Redis hold (`SET hold:slotId {sessionId, holdVersion} EX 300 NX`) is UX + authorization only — the actual double-booking guarantee is MongoDB's single-document atomicity plus `holdVersion`'s fencing, not Redis. Mongo-first-then-Redis on hold creation (not the reverse — Section 4's failure-mode trace)
- [ ] **Three separate correctness mechanisms — do not merge their implementations:**
  1. Concurrent claiming → atomic conditional write, needs no index for correctness
  2. Duplicate slot records → the `unitIndex` unique index (Workstream B)
  3. Cross-tenant authorization → `businessId` baked into the **same query filter** as every mutation, never a separate check-then-act step
- [ ] `Business.cancellationCutoffMinutes` (default 60, owner-editable): blocks **customer-initiated** cancel/reschedule once `now >= slot.datetime - cutoffMinutes`. Staff/owner routes are exempt entirely. Evaluated live from the current slot on every request, pure UTC comparison
- [ ] **Retry safety reuses existing state — no idempotency-key subsystem.** A lost/retried hold/confirm/reschedule request is naturally idempotent via the same conditional writes already in place: a retry either finds the operation already reflected in current state (report success/no-op) or genuinely not yet done (perform it normally). No operation-ID field, no dedup table (Section 4)
- [ ] **Lazy hold release on claim** — when a claim fails because the target Slot is `held`, check Redis for that hold's key before giving up; if missing, attempt a conditional release **scoped to the exact observed `holdVersion`** (never status alone), then unconditionally retry the original claim. This is a *fenced* release, distinct from the *unconditional* releases used by removal/retirement cascades. `process-hold-expiry` (Workstream D) remains a periodic backstop, not the only path back to `available` (Section 4)
- [ ] **Past-slot filtering is query-time only** — customer/public availability queries include `datetime >= now` (server UTC); a Slot whose time passed unclaimed simply stays `available` in Mongo forever, nothing sweeps it. No new Slot status, no background job. Staff/owner dashboard queries deliberately do NOT apply this filter (Section 3)

---

## Workstream D — Customer Self-Service, Notifications, Realtime, Jobs, AI

**Customer identity (Section 2/9a/10)**
- [ ] `Bookings.customer: { name, contactType: 'email' | 'phone', contact }` — `contactType` explicit, never inferred from string shape. Email lowercase+trim; phone normalized to **E.164, single-country MVP scope** (deliberate, not premature internationalization)
- [ ] **Same normalization function** used everywhere contact is compared: booking creation, AI risk-score lookup, magic-link resend lookup
- [ ] Identity = `businessId + contactType + normalizedContact` — no cross-method (email vs. phone) or cross-time identity merging

**Magic link (Section 9a)**
- [ ] Token: `crypto.randomBytes(32)` → base64url, `accessTokenHash = SHA-256(token)` stored, raw token never persisted
- [ ] Raw token never reaches any log — request/access logging must exclude it whether it would otherwise appear via URL, body, or headers; same rule for `StaffInvitations`' raw token (identical model). Only the hash is ever safe to log (Section 9a)
- [ ] Entropy (256 random bits) is the real security guarantee; the `accessTokenHash` unique index is defense-in-depth only, not the mechanism
- [ ] SHA-256, not bcrypt/Argon2 — the token has no feasible guess space regardless of hash speed
- [ ] One-time exchange: frontend `POST`s raw token (body, never URL query) to an exchange endpoint → verified → short-lived (1hr) `HttpOnly`/`Secure`/`SameSite=Strict` cookie scoped to one `bookingId` issued → URL scrubbed via `history.replaceState`
- [ ] The manage route resolves the cookie to a `bookingId` only — every mutation calls the **same** `bookings.cancelBooking()`/`rescheduleBooking()` functions staff/owner routes call
- [ ] `accessTokenExpiresAt = booking.slot.datetime + 7 days` — fixed application constant, recomputed live on reschedule
- [ ] **Access tiers are purely time-based (cutoff, then expiry) and independent of `Booking.status`** — a cancelled/completed/no-show booking stays viewable under the same rule; mutation on a non-`confirmed` booking is always rejected by the underlying shared functions regardless of tier, not by special-cased tier logic
- [ ] Resend: always the same neutral response regardless of match; rate-limited by IP **and** normalized contact; invalidates the old token on reissue. If a customer has multiple upcoming bookings, resend targets the **soonest** one — a deliberate fallback-only default, not a "manage all bookings" feature
- [ ] A customer with no email on file has **no** magic link and no self-service access at all — staff/owner can still manage the booking normally

**Realtime (Section 7)**
- [ ] Tenant-scoped rooms (`business:${businessId}`) — customers and staff share this room today, and current emitted payloads (`{slotId, status}` / `{providerId, datetime, remaining}`) carry **no customer PII** — keep it that way
- [ ] Best-effort, no retry, no delivery guarantee — a missed emit is corrected by the client's next normal fetch, nothing depends on delivery
- [ ] **Constraint for later:** if a staff-facing "live booking feed" showing customer name/contact is ever built, it must go through a separate authenticated `business:${businessId}:staff` room — never added to the shared public room

**Jobs (BullMQ, Section 6)**
- [ ] `send-transactional-email`, `send-reminder-email` (24h/1h, no catch-up for already-passed windows), `process-hold-expiry` (clears `holdVersion` on release), `waitlist-notify`, `generate-weekly-slots` — as specified in the doc
- [ ] Token-carrying jobs (`send-transactional-email`) configure both `removeOnComplete` and `removeOnFail`
- [ ] Every job uses BullMQ's standard bounded retry (a small fixed attempt count, exponential backoff) — never unlimited retries. Exact attempt count/backoff base is a tuning parameter, not locked, since nothing about correctness depends on it (every job that touches domain state already self-validates or is idempotent, Section 6)
- [ ] `send-reminder-email` and the business-creation welcome email have **no resend path** if enqueue fails — named, accepted, low-stakes silent-loss risks (the booking/account itself is unaffected either way)
- [ ] **`send-reminder-email` self-check, never authoritative:** cancel/reschedule do **not** delete or locate old reminder jobs — every worker execution re-reads Mongo and requires `Booking.status === 'confirmed'` **AND** the Booking's currently-resolved `Slot.datetime` matches the datetime the job was scheduled against; either failing is a silent no-op. Accepted residual risk: a booking rescheduled more than once that cycles back to a previously-used exact datetime can produce two dangling jobs that both validate and both send — a narrow notification-duplication risk, not a Booking/Slot correctness problem; no `scheduleVersion`/dedup field added for MVP (Section 6)
- [ ] **Project-wide notification policy: best-effort, no exactly-once machinery** — applies uniformly to confirmation/cancellation/reschedule/reminder/waitlist notifications. No transactional outbox, no sent-ledger, no dedup infra. Duplicate delivery and silent loss (post-commit enqueue failure) are both accepted MVP risks — describe as "best-effort; duplicates and silent loss are accepted risks," never as strict "at-least-once." Nothing about Booking/Slot correctness ever depends on notification delivery (Section 8)
- [ ] Waitlist-notify: **advisory only** — "this slot is available right now," never an exclusive claim, no reservation state. Fires on any `confirmed → available` transition (plain cancel or reschedule's old-slot release), never on `confirmed → cancelled`. Re-verifies `status: 'available'` immediately before notifying. Matching rule: `desiredServiceId` required match; `desiredProviderId` optional — exact match if set, any provider offering the service if not; ordered by `createdAt`
- [ ] Notify → expire/convert cascade: successful notify schedules a delayed `waitlist-expire-check` job for that entry; if the slot is still `available` when it fires, mark `expired` and re-run matching for the next entry; otherwise mark `converted` (an approximation — no accounts to confirm the claimant, but a mislabel here has no functional consequence) (Section 6)
- [ ] No TTL/cleanup for stale `waiting` entries — named, accepted gap; Section 3's active-provider/service invariant already makes a stale entry permanently inert, never harmful

**AI no-show scoring (Section 10)**
- [ ] Customer identity for this lookup = normalized `customer.contact`, scoped to the current `businessId` only — no cross-tenant resolution
- [ ] `noShowRiskNote` is **staff/owner-only** — never in any customer-facing response, at the serialization/projection layer, not just the frontend display layer
- [ ] Scored by a **background job enqueued strictly after the confirming transaction commits** — same post-commit pattern as notifications; the confirmation response never waits on Gemini. `null` until the job succeeds (or permanently, on failure) — AI failure never blocks/delays/alters any booking operation
- [ ] The job's write is conditioned on `noShowRiskNote` still being `null` (`findOneAndUpdate({_id, noShowRiskNote: null}, ...)`), never an unconditional `$set` — this is what makes a duplicate/retried scoring job a safe no-op. **No `Booking.status` re-check before writing** — unlike the reminder job, writing this field has no externally-visible effect, so there's nothing equivalent to protect against (Section 10)
- [ ] Computed at most once per Booking, applies uniformly to every path that produces a confirmed Booking (customer self-service and staff/owner walk-ins alike), **never recomputed on reschedule**
- [ ] Purely informational — never gates/blocks/prioritizes booking, cancellation, confirmation, or rescheduling; no threshold, no enforcement policy for MVP

---

## Workstream E — API contract, deployment

**API response/error contract (Section 13, route reference Section 13a)**
- [ ] Every route mounted under `/api`; the full method/path/actor/auth table is Section 13a — implement against it directly rather than inventing parallel naming
- [ ] `{ data }` on success / `{ error: { code, message, ...safe metadata } }` on failure — every endpoint, no exceptions
- [ ] Status codes: `400` validation, `401` no/invalid/expired session, `403` authenticated-but-unauthorized **within the caller's own tenant**, `404` genuinely-missing **and** any cross-*principal* resource, `409` state conflicts, `429` rate-limited, `500` unexpected
- [ ] **401 → frontend clears auth state, redirects to login. 403 → frontend stays logged in, shows in-context permission error.** Never redirect to login on a 403
- [ ] **Cross-principal access (wrong tenant OR wrong customer within the same tenant) always returns 404, never 403** — never reveal existence via status/message/metadata. 403 reserved for same-tenant role/permission failures only
- [ ] **Explicit allowlist projection per response, never a raw Mongo document, never a denylist.** Two tiers: customer projection, staff/owner projection. Never serialized to any client at any tier: `passwordHash`, `accessTokenHash`, `holdVersion`, session identifiers, Redis keys. `noShowRiskNote` staff/owner tier only. Same rule applies to Socket.IO event payloads
- [ ] Untrusted/anonymous-caller endpoints (magic-link open, login) return identical responses for not-found/expired/revoked — does **not** apply to authenticated owner/staff actions on resources already in their own dashboard (e.g. invitation resend)
- [ ] Validation errors: `{ error: { code: 'VALIDATION_ERROR', message, fields: {...} } }` — field-level detail safe since it's the caller's own input
- [ ] No pagination envelope (no unbounded-list endpoint exists); optional fields always present as `null`, never omitted; all dates ISO 8601 UTC; Mongo `ObjectId`s exposed directly as opaque strings (`id`, not `_id`), no obfuscation layer

**Deployment (Section 14)**
- [ ] Single combined deployment — Express serves API + built frontend from **one origin**. True same-origin: zero CORS config, no `SameSite=None`, **no CSRF middleware for MVP**
- [ ] All application routes mounted under `/api` (Section 13a's route reference); `/health` stays unprefixed, checked independently of API versioning — everything else on the origin is the frontend's static build, served for any non-`/api` path
- [ ] Genuinely cross-site default-subdomain hosting (different registrable domains for frontend/backend) is explicitly rejected for MVP
- [ ] BullMQ worker runs as a separate process/service if the host requires it, pointed at the same Redis instance — a deployment-topology detail, not a code change
- [ ] Frontend/backend remain separate apps in the monorepo regardless of deployment shape

---

## Explicitly out of scope — do not build

Multi-business ownership · multi-provider bookings (driving school / contended-room patterns) · payment integration · SMS/push notifications · analytics dashboards (stretch only, Phase 5) · business ownership transfer · business deactivation/deletion (a Business is permanent once created, same reasoning as ownership transfer — Section 2) · `suspended` staff state · invitation audit trail / resend history · forced password reset on reactivation · denormalized staff-name snapshot on historical bookings · service **name/price** snapshot on historical bookings (Section 2c/2b — historical bookings resolve `serviceId` live; **duration is the one deliberate exception and IS snapshotted onto `Slots.durationMinutes`, Section 2**) · automatic reassignment or cancellation of confirmed bookings on staff removal, resource retirement, or service deactivation · a general recurrence/exception scheduling engine (correct UTC storage + timezone display is required; holiday/blocked-day handling is not) · constant-time protection on the resend endpoint · resend features for reminder/welcome emails · automatic regeneration of already-generated slots on a resource capacity change · Gmail-specific email alias normalization (dots/plus-tags) — plain lowercase+trim only · JWT (staff/owner auth is server-side Redis sessions, Section 9) · idempotency-key infrastructure (retries reuse existing state) · individual-session listing/revocation UI · manager/delegated-staff role · absolute session-lifetime cap · pagination · Mongo ObjectId obfuscation · CSRF middleware (not needed under the locked single-origin deployment) · exactly-once notification delivery.

---

## Status

Every decision from the full design review — including four rounds of adversarial re-challenge covering the hold-confirmation fencing token, the Slot/Booking state-machine split, the Service deactivation lifecycle, the Booking↔Slot reuse/partial-unique-index correction, the generation-vs-removal race mitigation, and a full 23-decision closure covering customer identity, retry/hold-sweep mechanics, the slot-duration snapshot exception, availability-template edits, resource retirement, reminder self-checks, session-based staff/owner authentication (replacing the earlier JWT model), password hashing, session TTL, login rate limiting, stolen-session recovery, notification delivery policy, staff-lifecycle permissions, AI visibility, the API response/error contract, past-slot filtering, business immutability, the `PROJECT_PLAN.md` reconciliation, the `Users.role` enum, and the single-origin deployment topology — is now written into `queueless-plus-plus-architecture.md`. This checklist has no content of its own that isn't already in the architecture doc. Nothing is open or unresolved; the deferred items listed above are deliberate cuts, not gaps. Verdict: **Phase 2 ready, full-project architecture frozen.**
