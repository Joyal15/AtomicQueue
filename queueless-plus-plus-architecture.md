# QueueLess++ — Architecture & Design Document

Multi-tenant appointment and queue management platform. This is a scoped-down version of the original QueueLess++ brief — the good structural additions are kept, the scope-creep risks are cut or demoted to optional stretch work. See "What we removed and why" at the bottom of this section before reading further.

**Stack:** React + TypeScript + Tailwind + shadcn/ui (frontend) · Node.js + Express + TypeScript (backend) · MongoDB Atlas (database, with transactions) · Redis / Upstash (holds, caching, staff/owner sessions, login rate limiting — Section 9) · Socket.IO (real-time) · BullMQ (background jobs) · Gemini 1.5 Flash free tier (AI no-show scoring)

**Team:** 3 people · **Timeline: 3.5–4 weeks** (up from the original QueueLess's 2.5–3 weeks — this is a deliberate, justified increase, not scope creep)

**Architectural style:** Modular monolith. One deployable Express app, internally organized into clear feature modules (bookings, notifications, availability, tenants) that don't reach into each other's internals. No microservices — unnecessary at this scale and indefensible in an interview ("why microservices for a project with a handful of concurrent demo users" is a question you don't want to answer).

---

## What we removed and why

| Removed / demoted | Why |
|---|---|
| **Analytics dashboards** | Demoted to explicit stretch/Phase 4. A real analytics feature is its own mini-project (time-bucketed rollups, pre-aggregation vs. compute-on-read) with its own scalability story — building it shallow ("a few COUNT queries with a chart") undermines the rest of the project if an interviewer pushes on it. Better to not have it than to have a weak version of it. |
| **"Production-quality" framing** | Removed as a stated goal. This phrase quietly justifies open-ended scope (comprehensive logging, monitoring, exhaustive validation everywhere) that produces zero new interview talking points relative to time spent. We're building "one genuinely well-engineered product," not "a production SaaS company" — the standard you set for yourself originally. |
| **Comprehensive notification system (SMS + push + email + in-app)** | Scoped down to email-only for MVP, same reasoning as the original QueueLess (Twilio trial limitations, and multi-channel delivery is really the NotifyHub idea, a different project). |
| **Multi-business ownership (one user, many businesses)** | Considered and explicitly rejected for MVP. A `BusinessMembership` join model would require rewriting the auth middleware layer (every check becomes "does a membership exist" instead of "does this session's `User.businessId` match"), a session-record redesign (a single `userId` can't represent 1:many membership without also resolving *which* business per request), and a frontend business-switcher — real multi-day cost with no concrete requirement behind it. `Users.businessId` stays a single reference. |

## What we kept, and why it's worth the extra time

| Kept | Why it's a good addition |
|---|---|
| **Explicit booking state machine** | Formalizes states you already had implicitly — a design exercise, not new build time. Strong interview asset. |
| **Rescheduling as one atomic operation** | Genuinely harder and better than the original plain-booking concurrency story — a two-document atomic transaction (release old slot + claim new slot, both or neither) is a real upgrade. |
| **Cancellation** | Small addition, completes the state machine, needed for the waitlist auto-fill to make sense anyway. |
| **Modular monolith structuring** | Near-zero extra cost (it's how you should organize the code regardless), and gives you a strong, honest answer to "why not microservices." |
| **RBAC formalized (owner/staff, plus a separate customer identity path)** | Already implicit in original QueueLess; naming it explicitly is just being precise about what you're building. |
| **Unified staff/resource provider model** | Lets the same booking engine serve both person-based businesses (salon, clinic) and resource-based ones (turf, room, equipment) without a schema fork — a real modeling decision, not just more CRUD. |

---

## 1. Repository structure (modular monolith)

```
queueless/
├── apps/
│   ├── api/                     # Express backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── tenants/     # Business/org creation, slug routing
│   │   │   │   ├── auth/        # Session-based auth (Redis-backed, Section 9), RBAC middleware
│   │   │   │   ├── providers/   # Staff (people) + Resources (turfs/rooms/equipment) — unified "who/what gets booked"
│   │   │   │   ├── services/    # Service catalog per business
│   │   │   │   ├── availability/# Slot generation from provider (staff or resource) schedules
│   │   │   │   ├── bookings/    # THE core module — state machine, atomic ops
│   │   │   │   ├── waitlist/    # Auto-fill on cancellation
│   │   │   │   ├── notifications/ # Email queue, reminder scheduling
│   │   │   │   └── realtime/    # Socket.IO gateway
│   │   │   ├── jobs/            # BullMQ workers (reminders, waitlist processing)
│   │   │   ├── lib/             # Shared: db connection, redis client, logger
│   │   │   └── server.ts
│   └── web/                     # React frontend
│       ├── src/
│       │   ├── features/        # Mirrors backend modules
│       │   └── ...
├── packages/
│   └── shared-types/            # TS types shared between api/ and web/
```

**Module boundary rule:** modules communicate only through their exported service functions, never by reaching into another module's models directly (e.g., `notifications` calls `bookings.getBookingById()`, it never queries the `Bookings` collection itself). This is what makes it "modular" rather than just "a monolith" — and it's the honest answer to "how would you split this into microservices later if you needed to" (each module is already a natural service boundary).

---

## 2. Database schema

```
Businesses
  - _id, name, slug (unique), ownerId (ref → Users)
  - timezone (IANA string, e.g. 'Asia/Kolkata')   # all Slot datetimes are stored in UTC;
                                                    # this is the single field used to render/interpret them locally
  - cancellationCutoffMinutes (int, default 60, owner-editable)   # customer-facing cancel/
    reschedule cutoff — see Section 3 and Section 9a. Unrelated to the magic-link token's
    own expiry (Section 9a), which is a fixed constant, not configurable per business.
  # A Business is permanent once created through the application — no deactivate, delete,
  # archive, or shutdown path exists for MVP, explicitly out of scope for the same reason
  # ownership transfer is (Section 4d): a real product needs this eventually, nothing about
  # this project's actual scope requires it now. Test/demo-business cleanup is an out-of-band
  # database/administrative concern, not an application feature. Nothing about the data model
  # prevents adding a status field later if this ever becomes a real requirement.

Users
  - _id, name, email (unique, normalized — lowercase + trim before storage and before
    every comparison; same normalization rule used for StaffInvitations, Section 9b)
  - passwordHash (bcryptjs, cost factor 12 — Section 9)
  - passwordChangedAt (UTC, millisecond precision) — stamped in the SAME document write as
    passwordHash on every password change (never a separate write), so there is no window
    where a new password is stored but old sessions aren't yet invalidated. Used to reject
    any session issued before the change (Section 9).
  - sessionsInvalidatedAt (UTC, millisecond precision, nullable) — set only by an explicit
    "log out everywhere" action (Section 9); independent of passwordChangedAt, checked with
    the same comparison logic, ORed together (either one alone invalidates older sessions)
  - role: 'owner' | 'staff'   # deliberately NOT 'customer' — customers never have a Users
    document at all (Section 9a's contact-based identity is entirely separate). Immutable
    after creation for MVP: assigned once at signup (owner) or once at invitation-acceptance
    (staff), never changed thereafter — there is no role-change feature in this design.
  - businessId (ref)   # every Users row belongs to exactly one business; there is no
    "null for customers" case, since customers never get a Users row at all
  - status: 'active' | 'removed'   # see Section 9b for the removal/reactivation lifecycle
    this drives
  # Staff accounts are provisioned only by owner invitation (Section 9b) — staff never
  # self-register into a role/businessId, that's a tenant-isolation hole, and there is no
  # owner-set-password path either (Section 9).
  # An owner can also act as a provider (see Providers below) without a separate staff account.
  # Exactly one owner per business, fixed at creation (Section 4d) — no ownership transfer,
  # no path ever creates a second owner for an existing business.

Services
  - _id, businessId (ref), name, durationMinutes, price
  - isActive (bool, default true)   # soft-disable; existing Bookings/Slots keep referencing
                                      # the historical record via serviceId, live, regardless
                                      # of this flag — see Section 2c for the full deactivation
                                      # cascade (blocked/cancelled Slots, generation exclusion,
                                      # new-booking rejection)

Resources
  - _id, businessId (ref), name, type (free-text label, e.g. 'turf', 'room')
  - capacity (int, default 1)   # number of interchangeable, anonymous parallel units
                                  # (e.g. "5 identical badminton courts, customer doesn't care which").
                                  # If units need individual identity (assigned court number shown
                                  # to the customer), model each as its own Resource row with capacity 1
                                  # instead of bumping this number.
  - status: 'active' | 'removed'   # a Resource's retirement lifecycle deliberately mirrors
    Users' staff removal (Section 9b) exactly — same two states, same reasoning (no
    principled asymmetry between "a staff member left" and "a resource was retired," both
    are just "this provider is no longer available"), same transactional cascade. See
    Section 9c for the full mirrored lifecycle.

# "Provider" = whoever/whatever a Slot is generated for. Two kinds, one shape:
#   - a Staff provider is a Users row with role 'staff' (or an owner acting as provider)
#   - a Resource provider is a Resources row
# Slots/ProviderAvailability reference providerId + providerType so either kind plugs into
# the same generation/booking/reschedule machinery without a schema fork.

ProviderAvailability
  - _id, businessId (ref), providerId (ref → Users or Resources), providerType: 'staff' | 'resource'
  - serviceId (ref)              # REQUIRED — see "Multi-service providers" note below
  - dayOfWeek, startTime, endTime   # recurring weekly template, in the business's LOCAL
    wall-clock time (Business.timezone) — an owner thinks "Monday 9am-5pm," not in UTC.
    Converted to UTC only at generation time (Section 6), never stored pre-converted, so a
    later correction to Business.timezone applies to all future generation automatically
  # ProviderAvailability is a generation TEMPLATE, not a live schedule. Edits are supported
  # in place (the owner changes the row directly, no versioning/history kept) and affect
  # only FUTURE runs of generate-weekly-slots (Section 6) — already-generated Slots are never
  # retroactively reconciled, resized, or deleted as a result of a template edit. This is a
  # deliberate simplicity choice: reconciling already-generated (and possibly already-held or
  # -confirmed) Slots against a changed template is real, unjustified complexity for this
  # MVP's scale — an owner who changes their hours sees the new hours reflected starting with
  # the next generation run, not applied backward onto slots that already exist.

Slots
  - _id, businessId (ref, denormalized), providerId (ref), providerType: 'staff' | 'resource'
  - serviceId (ref), datetime
  - durationMinutes (int) — snapshotted from Service.durationMinutes ONCE, at generation
    time, and never updated again for that Slot. This is the single deliberate exception to
    this design's otherwise-universal "no snapshot, live resolution" rule (Service.name and
    Service.price stay live-resolved everywhere, including on historical Bookings) — duration
    is different because it already has a physical consequence baked into a generated Slot's
    end time the moment it's created; a later change to Service.durationMinutes must not
    retroactively resize a Slot that was already generated (and possibly already booked) at
    the old duration. Unaffected by reschedule (the new Slot carries its own independent
    snapshot from its own generation), by Service deactivation/reactivation (Section 2c —
    reactivation doesn't regenerate or resize existing Slots), and by historical Bookings
    (always display the Slot's own snapshotted duration, never a live Service lookup).
    Reminders/notifications and the AI risk scorer (Section 10) that need an appointment's
    end time read this field, never Service.durationMinutes directly.
  - unitIndex (int) — 0 for a staff provider; 0..capacity-1 for a resource provider's parallel
    units (Section 2a/4b). Distinguishes otherwise-identical interchangeable slot documents so
    a genuine uniqueness constraint is possible — see Section 2b for the index itself.
  - status: 'available' | 'held' | 'confirmed' | 'cancelled' | 'blocked'
    # 'completed'/'no-show' are NOT Slot states — they exist only on Booking.status (below).
    # A Slot has no independent notion of appointment outcome: once 'confirmed' it stays
    # 'confirmed' regardless of whether the appointment was fulfilled, since nothing ever
    # queries a Slot for that — every outcome-aware consumer (receipts, the AI scorer,
    # Section 10) reads Booking.status instead. Keeping outcome tracking on Booking only
    # removes a duplication that has no functional purpose. 'blocked' is kept as its own
    # terminal state, distinct from 'cancelled' — see Section 3 for why.
  - holdVersion (ObjectId, nullable) — a fencing/version token, NOT a credential and NOT
    secret, regenerated fresh every time a slot transitions available → held. Non-null iff
    status === 'held'; cleared to null on every held → X transition. See Section 4, "Hold
    confirmation and the fencing token," for the full mechanism and why it's needed.
  - version (int, reserved for optimistic checks on non-booking edits, e.g. staff manually
    moving a slot's time before it's booked — NOT used by the booking/hold state transitions
    themselves; unrelated to holdVersion above, which is used exclusively by the hold/confirm
    flow)

Bookings
  - _id, businessId (ref, denormalized), slotId (ref)   # the booking's CURRENT slot — a
    pointer, not a historical occupancy log. Reschedule overwrites this field; nothing
    preserves which slot a booking used to point at before that overwrite (Section 2b/4)
  - customer: { name, contactType: 'email' | 'phone', contact }   # no account, per original
    design. contactType is explicit, never inferred from the string shape of contact.
    contact is normalized before storage: email is lowercase+trimmed (same rule as
    Users.email); phone is normalized to E.164, single-country MVP scope (no international
    dialing-code disambiguation) — a deliberate, named scope limit, not an oversight. The
    SAME normalization function is used everywhere contact is compared: booking creation,
    the "same customer" lookup for AI risk scoring (Section 10), and the magic-link resend
    lookup (Section 9a). Customer identity is `businessId + contactType + normalizedContact`
    — no cross-method (email vs. phone) or cross-time identity merging; a customer who books
    once by phone and once by email is treated as two distinct identities, not reconciled.
  - createdBy (ref → Users, null)      # set when staff creates a walk-in booking on a customer's behalf
  - status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
    # Booking is the sole owner of appointment-outcome tracking (completed/no-show) — see
    # the note on Slots above. Booking.status answers "what ultimately happened to this
    # appointment"; Slot.status answers "can this time currently be claimed, and why not."
  - accessTokenHash (string, nullable, unique **sparse/partial** index)   # SHA-256 hash of
    the customer's magic-link credential — the raw token is never stored, only ever emailed
    once (Section 9a). Absent entirely for a phone-only booking (Section 9a's no-email
    boundary) — the index MUST be sparse (or a partial index on `{ $exists: true }`), not a
    plain unique index: MongoDB's default unique-index behavior treats multiple documents
    that both omit a field as a collision (only one document may omit a uniquely-indexed
    field), which a plain unique index would hit on the second-ever phone-only booking
  - accessTokenExpiresAt   # = slot.datetime + 7 days, a fixed application constant (NOT a
    Business setting) — recomputed live whenever the booking is rescheduled to a new slot.
    Absent whenever accessTokenHash is (same condition)
  - noShowRiskNote (string, nullable)   # AI-generated risk note (Section 10), staff/owner-
    ONLY — never exposed through any customer-facing surface (magic-link responses, emails,
    or otherwise). Scored by a background job enqueued strictly after the booking-
    confirmation transaction commits (same post-commit pattern as notifications, Section
    6/8) — the confirmation response never waits on Gemini. null immediately after booking
    creation, populated shortly after if/when the job succeeds, permanently null on AI
    failure/timeout. Computed at most once per Booking, applies uniformly to every path that
    produces a confirmed Booking (customer self-service and staff/owner walk-ins alike), and
    is never recomputed on reschedule — the original note persists unchanged for the
    booking's lifetime, even after it points at a different slot.
  - createdAt, cancelledAt

WaitlistEntries
  - _id, businessId (ref), customer: { name, contact }
  - desiredServiceId (required), desiredProviderId (optional — ref → Users or Resources)
  - status: 'waiting' | 'notified' | 'expired' | 'converted'   # see Section 6 for the
    notify → expire/convert cascade
  - createdAt
  # No TTL or cleanup job for stale 'waiting' entries (e.g. a desired provider later
  # removed, a desired service later deactivated) — a named, accepted MVP gap, low-stakes:
  # Section 3's invariant (a Slot can only become 'available' for an active provider AND
  # service) already guarantees a stale entry simply never matches anything again; it isn't
  # harmful, just an unbounded, never-swept collection. Not built, not silently broken.
```

**Design decisions worth explaining in an interview:**
- `businessId` denormalized onto `Slots` and `Bookings` directly (not just inherited via joins) — every query filters by tenant, a join chain to get there would be wasteful.
- `Slots` and `Bookings` are separate collections rather than one merged collection — a slot's *existence* (provider availability) is independent of whether it's ever booked; keeping them separate makes "generate next week's slots from provider availability" a clean, independent job that doesn't need to know anything about booking state.
- **Staff and Resources are unified under one `providerId`/`providerType` shape** rather than forcing a resource-based business (a turf, a room) to fake a "staff" row. A resource with `capacity > 1` (e.g. 3 identical courts) generates one `Slot` document per unit per time window — this keeps the booking write path a single-document atomic `findOneAndUpdate` (Section 4) with no `$inc`-based capacity counter, at the cost of a few more documents. That's a deliberate tradeoff: it reuses the same correctness mechanism instead of inventing a second one for resources.
- **Multi-service providers are a known, explicitly scoped-down MVP limitation.** `ProviderAvailability` requires a `serviceId`, so a provider offering two services with different durations (e.g. haircuts vs. coloring) needs two separate availability template rows with non-overlapping day/time windows set by the owner — the system does not automatically detect or prevent overlapping windows across services for the same provider. A real product would need either fixed-granularity slot chopping with multi-slot holds, or explicit overlap validation in the schedule UI; both are more machinery than an MVP needs, so this is named as a cut, not silently broken.
- **A booking has exactly one provider, always.** Multi-provider bookings — a driving lesson needing an instructor *and* a vehicle simultaneously, or a massage needing a therapist *and* a contended (non-dedicated) room — are explicitly out of scope for MVP. Both are structurally the same problem: two independently-contended things that must be claimed together, which would force a transaction onto the booking hot path and undercut the single-atomic-write story that's the centerpiece of this project. Not built, not silently broken.
- **Provider is a domain concept, not a persisted collection.** There is no `Providers` table. `providerId` + `providerType` is a polymorphic reference that resolves to either a `Users` row (`providerType: 'staff'`) or a `Resources` row (`providerType: 'resource'`) — see Section 2b for how that reference is validated and kept safe.

### 2a. Worked example: a business that is 100% resource-based (no staff at all)
This is the case you flagged — a turf/court booking business isn't "service-based with a staff calendar," it has no person-provider in the loop at all. Walking it through end to end to make sure nothing silently assumes a `staff` row exists:

1. **Signup.** Owner creates the business. This creates exactly one `Users` row (`role: owner`). No `staff` `Users` rows are created and none are required — `staff` accounts are opt-in (e.g. a front-desk person who checks people in), never mandatory.
2. **Catalog setup.** Owner creates a `Services` row: `"1-hour turf slot"`, `durationMinutes: 60`, `price: 800`. `Services` represents *the bookable offering*, not a person's skill — it works identically whether what's behind it is a stylist or a rectangle of grass.
3. **Resource setup.** Owner creates a `Resources` row: `name: "Main Turf"`, `type: "turf"`, `capacity: 1` (or creates 3 `Resources` rows — "Turf A/B/C" — if the courts are distinct and separately named, per the capacity-vs-separate-rows note above).
4. **Availability.** Owner creates a `ProviderAvailability` row with `providerId` → that Resource's `_id`, `providerType: 'resource'`, `serviceId` → the turf-slot service, e.g. `dayOfWeek: all, startTime: 06:00, endTime: 22:00`. Nothing here references a `Users` row.
5. **Slot generation.** `generate-weekly-slots` reads `ProviderAvailability` exactly the same way for a resource as for staff — chops the 06:00–22:00 window into 60-min `Slots`, each with `providerId`/`providerType: 'resource'` pointing at the turf, no `staffId`-shaped concept anywhere in the path.
6. **Booking, holding, cancelling, rescheduling, waitlisting** — every mechanism in Sections 3, 4, and 6 operates on `Slots` by `providerId`/`providerType`, so all of it (the atomic conditional write, the reschedule transaction, waitlist matching by `desiredProviderId`) works unchanged with zero staff involved. If `capacity > 1` (multiple identical turfs), claiming works slightly differently from the single-unit case — see Section 4b for the exact mechanic (claim by `providerId` + `datetime` rather than a specific `slotId`, so concurrent bookers each land on a different interchangeable unit automatically).
7. **What has no meaning here, and is just absent:** nothing staff-specific applies at all if the business has no staff accounts — staff visibility (Section 9) is business-wide by design anyway, not scoped by `providerId`, so a pure-resource business with zero staff logins simply has no staff dashboard users, not a special case in the access model.
8. **If the owner later adds a front-desk staff account** (to check customers in, mark no-shows), that staff row still isn't a *provider* — it's an operator with `role: staff` who manages bookings, but no `ProviderAvailability`/`Slots` ever reference their `Users._id` as a `providerId`, because they're not the thing being booked. Provider and "has a staff login" are independent — a business can have staff logins with zero staff providers, provider rows with zero staff logins, or any mix.

So: nothing in the schema assumes a person exists. `providerType` is the only fork, and a business can be pure-resource, pure-staff, or a mix (e.g. a badminton academy booking both a court *and* a coach) without any special-casing beyond picking `'resource'` vs `'staff'` per row.

### 2b. Provider validation & data integrity

MongoDB has no foreign keys and cannot validate `providerId` against another collection at write time — a real, structural limitation of a document database, not a gap we've overlooked. What MongoDB's schema validation (`$jsonSchema`) *can* enforce, at the database level, independent of application code: `providerType` restricted to the exact enum `['staff', 'resource']`, `providerId` typed as a valid `ObjectId`, and `status` restricted to the state machine's exact values (Section 3) — cheap, real protection against a typo silently corrupting data. What it *cannot* enforce: that a `providerId` claiming `providerType: 'staff'` actually points at an existing `Users` document rather than a `Resources` document (or nothing at all), or that the referenced provider belongs to the same business as the document referencing it. An `ObjectId` is opaque — Mongo has no way to know which collection it came from without a lookup, and validators can't perform cross-collection lookups.

**This is why provider validation is centralized in one `providers`-module service function**, called by every write path that sets or changes a `providerId`/`providerType` pair (`ProviderAvailability` creation, slot generation, any admin edit) — never re-implemented per route. It verifies, in order: (1) a document with that `_id` exists in the collection implied by `providerType`; (2) it belongs to the caller's `businessId`; (3) if `providerType: 'staff'`, the referenced `Users` row is **eligible to act as a provider**. That last check is deliberately framed as its own concept, not an inline RBAC check — "eligible to act as a provider" happens to mean `role in {staff, owner}` today, but keeping it a named predicate rather than a scattered `role === 'staff' || role === 'owner'` comparison means provider eligibility and RBAC roles can diverge later (e.g. a future role that's staff but not yet bookable) without hunting down every place the two were silently assumed to be the same thing.

**`unitIndex` and the slot-uniqueness index.** A resource with `capacity: N` generates N interchangeable `Slot` documents at the same `datetime` (Section 2a, Section 4b) — without something distinguishing them, no uniqueness constraint is expressible, since they're otherwise identical documents. `unitIndex` fixes this: `0` for every staff slot (capacity is implicitly 1), `0..capacity-1` for a resource's parallel units, assigned at generation time. This makes a genuine unique index possible: **`{businessId, providerId, providerType, datetime, unitIndex}`, unique** — the data-integrity backstop against duplicate/malformed slot generation (a generation bug, the weekly job racing itself). Deliberately, `serviceId` is *not* part of this key: a staff provider physically cannot hold two slots at the same instant regardless of which service they're nominally for, so including `serviceId` would incorrectly let the database store two overlapping slots for the same person. `providerType` stays in the key even though a MongoDB `ObjectId` is practically globally unique across collections (so `providerId` alone would almost certainly be enough) — kept deliberately as defense-in-depth against an application bug pairing a correct id with the wrong type, and for query self-documentation, at negligible index-size cost; not kept merely for elegance. A second, non-unique index, `{businessId, providerId, providerType, datetime, status}`, supports the hot-path claim query's performance — see Section 4c for why these are two separate mechanisms serving two separate purposes, not one index doing two jobs. Neither `holdVersion` (Section 4) nor `Services.isActive` (Section 2c) needs its own index — both are only ever checked alongside an already-indexed `_id` lookup, never scanned or filtered on independently. A third, partial index on `{status: 'held'}` supports `process-hold-expiry`'s sweep query (Section 6), which scans expired holds across the whole system rather than being scoped to one business/provider/datetime the way the claim query is — a genuinely different access pattern, not reusable from the two indexes above.

Other uniqueness already assumed elsewhere in this schema: `Users.email`, `Businesses.slug`, `Bookings.accessTokenHash`. **`Bookings {businessId, slotId}` is a partial unique index** — unique, with `partialFilterExpression: { status: 'confirmed' }` — deliberately not a plain unique index: a Slot is reused across its lifetime (available → held → confirmed → available, repeatable via cancellation or reschedule), so multiple Bookings legitimately share a `slotId` over time — one *current* (`confirmed`), any number historical (`cancelled`/`completed`/`no-show`) — and a plain unique index would reject the second-ever booking of a reused slot. The partial filter enforces the actual invariant — **at most one `confirmed` Booking may reference a given Slot at any instant** — as defense-in-depth: the transaction/conditional-write discipline in Section 4 already guarantees this structurally, so the index is a backstop, not the mechanism, the same framing already used for `unitIndex`'s uniqueness above. `businessId` stays in the key for query support and consistency with every other tenant-scoped index here, even though `slotId`'s own ObjectId uniqueness would already make it sufficient alone — same reasoning as keeping `providerType` in the Slots unique index.

**A Slot is reused, not single-use.** This is why `Bookings.slotId` cannot be a plain unique key, and why it must be read as **the booking's current slot pointer, not a historical occupancy log**: reschedule overwrites it (Section 4), and nothing else records which slot a booking used to point at before that overwrite. Terminal Bookings (`cancelled`/`completed`/`no-show`) are never mutated again by anything in this design, so they safely retain whatever `slotId` they had at the moment they became terminal — this is exactly what makes safe reuse possible with no cleanup step required. The one asymmetry: once a Slot's booking reaches `completed`/`no-show`, the **Slot itself is never reused** — it stays `confirmed` permanently (Section 3), since the appointment's `datetime` is now in the past and nothing browses or claims a past-dated slot (Section 6).

Supporting (non-unique) indexes beyond the ones above: `Users {businessId, status}` (staff listing, provider-eligibility checks), `StaffInvitations {businessId, email}` (Section 9b, already unique) and `tokenHash` (unique, acceptance lookup).

### 2c. Service lifecycle: deactivation, not deletion

Services are never hard-deleted. `Services.isActive` (Section 2) is the only lifecycle state, and its transitions are deliberately narrow — no scheduling-exception system, no additional abstraction beyond what already exists for staff removal and resource retirement (Section 9b), which this mirrors closely.

**`isActive: true → false` (deactivation) — one transaction, four effects on existing state:**

| Affected | Effect |
|---|---|
| `Slots` with `status: 'available'` for this service | → `'blocked'` immediately — no longer bookable |
| `Slots` with `status: 'held'` for this service | → `'cancelled'` immediately — any in-flight checkout is invalidated (`holdVersion` cleared, Section 4) |
| `Slots` with `status: 'confirmed'` for this service | Left untouched — their `Bookings` remain valid, operable historical/operational records (view, cancel, reschedule-away, mark completed/no-show all still work, same reasoning as Section 9b's "removed provider" case) |
| `ProviderAvailability` rows referencing this service | Deactivated/removed as part of the same transaction — no template survives to generate future slots for it |

This is the same shape of grouped mutation as staff removal (Section 9b) and resource retirement — several documents that must move together so an inactive Service is never left with claimable capacity. Do this transactionally for exactly that reason: without it, a mid-deactivation crash could leave an `available` slot for a service the owner just turned off.

**Ongoing enforcement, not just a one-time cascade:**
- `generate-weekly-slots` never generates a `Slot` for an inactive service — it checks `Services.isActive` the same way it checks provider-active status (Section 6), with the identical pre+post-check-and-compensate mitigation for the same class of race (a service being deactivated mid-generation-run).
- New bookings against an inactive service are rejected outright, **including a claim attempt against a slot that was somehow already generated** — a defensive re-check at claim time, not just at generation time, belt-and-suspenders against the same narrow generation-race window.
- `ProviderAvailability` creation (Section 2b's centralized provider-validation function) also validates the referenced `Service.isActive` — an owner cannot create new availability against a service that's currently off.

**Reactivation (`isActive: false → true`) does not resurrect anything.** Previously `blocked`/`cancelled` Slots stay exactly as they are — there is no "un-blocking" a specific already-generated slot, the same rule Section 3 establishes for the direct-block action generally. Deleted `ProviderAvailability` is not restored. The owner must explicitly reconfigure availability for the service again, identical to staff/resource reactivation (Section 9b) needing new `ProviderAvailability` created from scratch.

**The invariant this preserves:** historical/confirmed bookings remain valid and resolvable through their `serviceId` at all times (Section 2b's "no snapshot, live resolution" decision is untouched by any of this) — but an inactive Service is never a source of *new* bookable capacity, enforced the same way provider inactivity is enforced (Section 3/4), not by a second, parallel mechanism.

---

## 3. State machines: Slot and Booking

Slot and Booking are deliberately separate state machines (Section 2) — a Slot answers "can this time currently be claimed, and why not"; a Booking answers "what happened to this specific appointment." They're related (a Booking always points at exactly one Slot) but not mirrors of each other; conflating them was an earlier source of duplicated states (Section 2's note on why `completed`/`no-show` live only on `Booking`).

### Slot state machine

```
                    ┌─────────────┐
                    │  available  │◄──────────────────────┐
                    └──────┬──────┘                        │
             │              │              │                │
   customer holds   staff blocks   staff/owner walk-in       │ waitlist auto-fill
             │              │              │                │ (confirmed → available,
             ▼              ▼              ▼                │  provider/service active)
      ┌───────────┐  ┌───────────┐  ┌───────────┐            │
      │   held    │  │  blocked  │  │ confirmed │────────────┘
      └─────┬─────┘  └───────────┘  └─────┬─────┘
    timeout │ confirm       (terminal)     │ booking cancelled,
      or removal/            no return     │ provider/service now
      retirement/                          │ inactive
      deactivation                         ▼
            │            ┌───────────┐
            └───────────►│ cancelled │
                         └───────────┘
                          (terminal, no return)
```

**Legal transitions:**
- `available → held` — customer claim, atomic conditional write (Section 4)
- `available → confirmed` — staff/owner walk-in booking, the same single-document atomic conditional write as a customer claim (`{ _id, status: 'available' }` → `{ status: 'confirmed' }`, `holdVersion` left `null` throughout since it never passes through `held`) — no transaction needed, same reasoning as Section 4c
- `available → blocked` — direct staff/owner action ("manual short-term closure," below), or a Service being deactivated (Section 2c)
- `available → cancelled` — staff/resource removal or retirement (Section 9b), or Service deactivation (Section 2c), targeting a still-unclaimed slot
- `held → confirmed` — hold confirmation, gated on `holdVersion` matching the specific hold being confirmed (Section 4)
- `held → available` — Redis TTL sweep only (`process-hold-expiry`, Section 6); this is the *only* cause of this transition
- `held → cancelled` — staff/resource removal, resource retirement, or Service deactivation, targeting a slot someone is mid-checkout on (Section 9b, Section 2c)
- `confirmed → available` — the shared cancel/reschedule-release function, when the slot's provider **and** service are both currently active — this is also what triggers a waitlist notification (Section 6)
- `confirmed → cancelled` — the same shared release function, when the provider or service is inactive — the slot must not be re-offered, so it does not return to `available`

**Illegal, explicitly (not merely unbuilt):**
- `blocked → *` and `cancelled → *` — both terminal, no transition out. "Un-blocking" a specific slot is not a supported operation; if a temporary closure needs to be undone, future `generate-weekly-slots` runs simply keep producing new `available` slots going forward (Section 6) — there's no reason to resurrect an already-generated one.
- `held → blocked` — blocking only ever targets an `available` slot; a slot someone is actively holding cannot be preemptively closed by this mechanism (there is no admin override for a slot mid-checkout, and none is built).
- `confirmed → held` / `confirmed → blocked` — no path touches an occupied slot this way.
- Any transition into or out of `completed`/`no-show` — these are not Slot states (see the note at the top of this section and Section 2).

**Manual short-term closure ("blocking").** Any staff/owner can directly transition a specific `available` slot to `blocked` — an atomic single-document conditional write (`{ _id, status: 'available' }` → `{ status: 'blocked' }`), the same mechanism class as claiming. This is the intended path for ad-hoc short-term unavailability (a provider calling in sick for one afternoon) — there is no separate "temporary unavailability" feature layered on top of provider/resource active-status; that flag means permanent removal/retirement (Section 9b), not a toggle for one bad day. `blocked` is kept as its own state, distinct from `cancelled`, specifically so a future feature (e.g. a "cancellation rate" metric) can't accidentally count a staff-initiated closure as a customer-driven cancellation — they're semantically different events sharing no other logic in common.

### Booking state machine

`confirmed → { cancelled | completed | no-show }` — all three terminal, no further transitions.

| Action | Who | Constraint |
|---|---|---|
| Cancel a `confirmed` booking | Customer (via magic link, Section 9a) | Blocked once `now >= slot.datetime - cancellationCutoffMinutes` |
| Reschedule a `confirmed` booking | Customer (via magic link) | Same cutoff |
| Cancel a `confirmed` booking | Staff/owner | No cutoff — exempt entirely, not overridden |
| Mark `completed` | Staff/owner only | Manual, no automatic detection |
| Mark `no-show` | Staff/owner only | Manual, no automatic detection |

Staff/owner can act on a booking whose provider has since been removed or whose service has since been deactivated — cancel, mark completed, mark no-show are all still legal (Section 9b/2c: "inactive" describes current bookability, never historical validity). The customer's magic link similarly keeps working under the same cutoff/expiry rules (Section 9a) regardless of provider/service status.

**Cutoff timing.** The cutoff is evaluated once, live, immediately before attempting the cancel/reschedule operation — it is a time-based business rule, not a concurrency guard, and re-checking it a second time inside the transaction would add nothing (these operations are fast and external-call-free, so the clock cannot meaningfully cross the boundary in between). The actual concurrency safety for cancellation comes from a different, cheaper mechanism: the mutation is conditioned on `Booking.status: 'confirmed'` (Section 4c's "same query filter as the write" discipline) — a customer and a staff member racing to cancel the same booking resolve cleanly, whichever write lands first wins, the second is correctly rejected as already-handled.

**Reschedule** is one transaction touching the old Slot, the new Slot, and the Booking (Section 4) — same `serviceId` only, same cutoff rule as a plain cancel. The old slot's release uses the exact same shared function above (`confirmed → available` or `confirmed → cancelled`, provider/service-active-dependent), and a waitlist notification fires after commit only on the `available` branch — never inside the transaction, never on the `cancelled` branch.

---

## 4. Concurrency & transaction strategy

### The core problem
Two customers attempt to book the same slot within milliseconds. Exactly one must succeed; the other must fail cleanly and be offered the waitlist.

### The solution: atomic conditional write, not read-then-write
```js
// Booking — single atomic operation, no race window
const holdVersion = new mongoose.Types.ObjectId();  // fencing token, not a credential — see below

const slot = await Slot.findOneAndUpdate(
  { _id: slotId, status: 'available' },
  { $set: { status: 'held', holdVersion } },
  { new: true }
);

if (!slot) {
  // Someone else claimed it first — offer waitlist immediately
  return { success: false, offerWaitlist: true };
}

// Redis write happens second, only after the Mongo write succeeds — see
// "Hold creation ordering" below for why this order, not the reverse
await redis.set(`hold:${slotId}`, JSON.stringify({ sessionId, holdVersion }), 'EX', 300, 'NX');
```

`sessionId` here is a client-generated UUID (created on first page load, stored in `localStorage`) sent with every hold/booking request from that browser — it's how the hold is later confirmed by the *same* client and how an abandoned hold can be identified. It is not an auth token and carries no identity; a customer has no account, so this is purely "which browser tab is holding this slot," nothing more.

**Hold creation ordering: Mongo first, Redis second — and why the reverse is worse, not just different.** Both orderings correctly resolve two customers racing for the same slot (each store's own primitive — Mongo's conditional write, Redis's `SET ... NX` — is independently atomic, so whichever order you pick, exactly one of two simultaneous claimants wins). The real difference is the failure mode when *one* store succeeds and the other doesn't. Mongo-first, Redis-fails: the only possible orphan is "Mongo says held, Redis has nothing" — exactly what the sweep job (Section 6) is already built to detect and clean up. Redis-first, Mongo-fails: the orphan would be "Redis says held, Mongo doesn't" — and nothing in this design scans for *that* shape of orphan; it would sit blocking every other claim attempt on that slot for the full Redis TTL, with no cleanup path at all. Report a hold as successful to the client only if *both* writes succeed; if the Redis write fails after the Mongo write succeeded, surface an error to the client (no compensating rollback) and rely on the sweep job to self-heal it as an ordinary expired hold.

**Hold confirmation and the fencing token.** The Redis hold alone is not sufficient to safely confirm a hold — between reading Redis and issuing the Mongo write, the hold could have already expired and been re-claimed by a different customer, and Mongo cannot atomically consult Redis to check. `holdVersion` closes this: a fresh, unique value (need not be cryptographically random — its only job is to differ across distinct hold events, not to resist guessing) generated at every `available → held` transition, stored on the `Slot` document itself. Confirmation is conditioned on **both** `status: 'held'` **and** `holdVersion` matching the specific hold being confirmed:

```js
const confirmed = await Slot.findOneAndUpdate(
  { _id: slotId, status: 'held', holdVersion: expectedHoldVersion },
  { $set: { status: 'confirmed', holdVersion: null } },
  { session, new: true }
);
if (!confirmed) throw new Error('Hold expired or no longer valid');
```

Trace the race this closes: customer X holds a slot (`holdVersion: V1`, in both Redis and Mongo). The hold expires and is swept back to `available`. Customer Y claims the same slot fresh — Mongo generates a *new* `holdVersion: V2`. X's delayed confirmation attempt, still carrying `V1`, executes against the *current* document, which now holds `V2` — the filter simply doesn't match, and X's stale confirmation is rejected. This holds regardless of *when* X's request happens to reach the server relative to the expiry/re-claim, because Mongo evaluates the filter fresh, against live state, at the instant of the write — not against whatever was true when X's request started. Given the fix costs one extra field and one extra filter condition, with no client-facing protocol change (the client only ever knows its own `sessionId`; `holdVersion` is read from Redis server-side and never round-trips to the browser), this closes what would otherwise be a real, if narrow, gap rather than merely narrowing it.

`holdVersion` is non-null iff `status === 'held'` — cleared to `null` on every `held → X` transition (confirm, sweep release, or removal/retirement/deactivation cancelling a held slot), piggybacked onto the same write that performs the transition, so this costs nothing extra in round-trips.

**Where the Redis check belongs, and why the ordering doesn't matter for correctness anymore.** The Redis check (does the presented `sessionId` match the stored one) happens once, immediately *before* the confirmation transaction starts — never inside it, since a Mongo transaction should never contain an external call (see "Transaction boundaries," Section 4e). Its only remaining job is *authorization* — is this the browser tab that created the hold — not staleness protection, which `holdVersion` now owns entirely and unconditionally. That split matters: the exact timing of the Redis check relative to the Mongo write is no longer a correctness question, only a minor freshness-of-authorization one, and "immediately before the transaction" is more than adequate for that.

**Retry safety: reuse existing authoritative state, never build idempotency-key infrastructure.** A client retrying a hold, confirm, or reschedule request after a lost/timed-out response (not knowing whether the original attempt actually succeeded) does not need a generic idempotency-key subsystem — every one of these operations is already safely retryable using the state that already exists. Two distinct concerns, worth keeping separate: **atomic conditional writes** are what prevent double-booking (a correctness property, Section 4's core mechanism); **retry detection** is only about giving an accurate response when a client re-sends a request whose original response was lost. A hold retry that lands after the original succeeded simply re-reads the current Slot/Redis state and reports "already held by you" rather than erroring; a confirm/reschedule retry is naturally idempotent because the underlying conditional writes (`status: 'held'` / `status: 'confirmed'`) either already reflect the prior success (in which case the retry's filter doesn't match, and the caller is told the operation already completed) or genuinely didn't happen yet (in which case the retry performs it normally). No new "operation ID" field, no request-deduplication table — the existing state IS the idempotency record.

**Lazy hold release on claim, closing the gap between Redis TTL and the periodic sweep.** `process-hold-expiry` (Section 6) is a periodic backstop, not the only way a stale hold gets cleared. When an incoming claim's conditional write fails because the target Slot is `held` (not `available`), the claim path checks Redis for that hold's key before giving up: if the key is missing (expired, evicted, or never successfully written — Section 4's hold-creation-ordering note), the claim attempts a **conditional release scoped to the exact observed `holdVersion`** — `Slot.findOneAndUpdate({ _id, status: 'held', holdVersion: observedHoldVersion }, { $set: { status: 'available', holdVersion: null } })` — never a release conditioned on status alone, since status alone can't distinguish the hold this claimant observed from a brand-new hold that happened to form in between. The original claim is then unconditionally retried against the now-current state. This is a *fenced* release (defensive, must never touch a newer hold than the one actually observed to be stale) — a fundamentally different operation from the *unconditional* releases used by resource/provider retirement cascades (Section 9b/9c), which authoritatively cancel whatever is currently held regardless of version, because a human action (removal) is the one giving the order, not a guess about staleness. Verified safe against: a claim arriving exactly at TTL expiry (Redis's own atomicity resolves this — the key either is or isn't there at the instant checked); a fresh hold forming in the gap between the stale check and the release attempt (closed by holdVersion-scoping — the release simply won't match a newer hold); two lazy-release attempts racing each other (both scope to the same observed holdVersion, so the losing one's conditional update just doesn't match, no double-release); and the periodic sweep firing concurrently with a lazy release (same shape — both are holdVersion-scoped conditional writes, whichever lands first wins, the second is a no-op).

### 4a. Payment — explicitly out of scope
There is no payment integration in this MVP. `held → confirmed` happens immediately once the hold succeeds — no confirmation/payment step gates it. If asked in an interview: "the state machine has a slot for a payment step between held and confirmed if I added Stripe/Razorpay later — the hold's Redis TTL already gives the right window for a real checkout flow — but wiring an actual payment provider wasn't worth the time for this scope."

### 4b. Capacity-aware claiming (resource providers with `capacity > 1`)
A resource with `capacity: N` has N interchangeable `Slot` documents at the same `datetime` (Section 2a) — the customer picks a time, not a specific anonymous unit, so the client cannot supply a `slotId` the way it does for a staff booking. The claim query drops the `_id` filter and matches on `(providerId, datetime, status)` instead:

```js
const holdVersion = new mongoose.Types.ObjectId();

const slot = await Slot.findOneAndUpdate(
  { businessId, providerId, providerType, datetime, serviceId, status: 'available' },
  { $set: { status: 'held', holdVersion } },
  { new: true }
);
```

This is still the single-document atomic conditional write from Section 4, unchanged — the only difference is the filter matches *any one* of N candidate documents instead of a specific `_id`. Two concurrent requests racing on the same time window each succeed on a *different* document: the instant one flips to `held`, it drops out of the `status: 'available'` filter for the next request. Capacity is enforced by "only N documents exist to claim," with no `$inc` counter and no separate capacity-tracking logic — and since a staff provider is just the `capacity: 1` case of the same query, **the client never needs to know a `slotId` for either provider type**; it always claims by `(providerId, datetime, serviceId)`.

Two consequences this has elsewhere:
- **Browsing is an aggregate, not a raw list.** The public availability view groups `Slots` by `(providerId, datetime)` and shows `count(status: 'available')` per bucket (e.g. "5–6pm — 2 of 3 left") — the customer is never shown or allowed to pick a specific anonymous unit, since the units aren't meaningfully different from each other.
- **The real-time emit (Section 7) carries the remaining count for that bucket, not just one slot's status** — `io.to(...).emit('slot:updated', { providerId, datetime, remaining: N })` — otherwise the UI can't move "2 of 3 left" → "1 of 3 left" without a full re-fetch on every claim.

**Past-slot filtering is query-time only, not a stored state.** Every customer/public-facing availability query includes `datetime >= now` (server's current UTC time) as part of its filter. A Slot whose time has passed without ever being claimed simply remains `available` in Mongo indefinitely — nothing transitions its status when its time passes, and no background sweep or `expired` state exists for this. Bookability from the customer's perspective is a live, computed condition, evaluated fresh on every read — the same "verify authoritative state, don't cache/store what's cheap to compute" pattern used for holds (Section 4), reminders (Section 6), and staff status (Section 9). Staff/owner dashboard queries deliberately do NOT apply this filter, since past slots are legitimately useful there for schedule/history review. Booking/claim mutations still rely entirely on the existing atomic conditional writes (Section 4) for concurrency safety — the past-time filter narrows what a customer is shown, it is never a substitute for or a component of the actual correctness mechanism.

### 4c. Three separate correctness mechanisms — do not conflate them

It's easy to blur these together since they all sit near the booking write path, but they solve three different problems and none substitutes for another:

1. **Concurrent slot claiming** (two customers racing for the same unit) is guaranteed by MongoDB's inherent single-document atomicity in `findOneAndUpdate` — this needs **no index at all** for correctness. An index on the filter fields makes the query fast under load; it doesn't make it correct, because that correctness was already free from the storage engine.
2. **Duplicate slot *records*** (a generation bug or a racing job creating two documents that both claim to be "unit 0 for provider X at 5pm") is what the `unitIndex`-based unique index (Section 2b) actually protects against — a data-shape guarantee, unrelated to claiming.
3. **Cross-tenant authorization** (making sure a request can only touch data belonging to its own business) is guaranteed by neither of the above — it's a service-layer discipline: `businessId` must be part of the *same query filter* as the mutation itself (e.g. `Slot.findOneAndUpdate({ _id: slotId, businessId: callerBusinessId, status: 'available' }, ...)`), never checked in a separate step before the write. A separate check-then-act step reopens exactly the kind of race this whole section exists to close.

### Reschedule — the harder case, needs a real transaction
Rescheduling touches **two documents** (release old slot, claim new slot) and both must succeed or neither does — this is what an atomic single-document update can't give you, and it's why a proper Mongo session/transaction is used here specifically (not for plain booking, where the single-document conditional update is sufficient and faster). **Reschedule's identity is always `bookingId`, never `slotId`** — given a Slot is reused (Section 2b), `oldSlotId` cannot by itself uniquely identify "the" booking being rescheduled, so it and `originalServiceId` are read *from* the identified Booking rather than independently resolved:

```js
// Identity for this whole operation is bookingId, resolved by the caller (magic-link
// cookie or staff auth) before any of this runs — never derived from slotId.
const booking = await Booking.findOne({ _id: bookingId, businessId: callerBusinessId, status: 'confirmed' });
if (!booking) throw new Error('Booking not found or no longer active');
const oldSlotId = booking.slotId;

let oldSlotOutcome, originalServiceId; // read outside the closure — oldSlotOutcome for the
                                        // waitlist check below, originalServiceId for the new-slot filter

const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // Old slot: the exact same shared release logic as a plain cancel (Section 3) —
    // available if its provider AND service are both currently active, cancelled
    // (never re-offered) otherwise. Also returns the slot's serviceId, needed below.
    ({ outcome: oldSlotOutcome, serviceId: originalServiceId } =
      await releaseSlot(oldSlotId, { session }));
    if (!oldSlotOutcome) throw new Error('Original booking no longer valid');

    // New slot: same serviceId as the original booking (Section 3's reschedule constraint),
    // and businessId baked into the same filter as the write (Section 4c's discipline) —
    // never omitted, even though a serviceId collision across businesses is already
    // practically impossible given globally-unique ObjectIds
    const newSlot = await Slot.findOneAndUpdate(
      { _id: newSlotId, businessId: callerBusinessId, status: 'available', serviceId: originalServiceId },
      { $set: { status: 'confirmed' } },
      { session, new: true }
    );
    if (!newSlot) throw new Error('Requested new slot no longer available');
    // If this throws, withTransaction aborts everything — including the old slot's
    // release above, which never persists. The customer's original booking is untouched.

    // Filtered by _id (the actual identity), not by slotId alone — Bookings.slotId is
    // reused across a slot's lifetime, so a bare { slotId: oldSlotId } filter could match
    // a stale, already-terminal Booking from a prior reuse cycle instead of this one.
    // status:'confirmed' stays as a consistency guard, not the identifying field.
    await Booking.findOneAndUpdate(
      { _id: bookingId, slotId: oldSlotId, status: 'confirmed' },
      { $set: { slotId: newSlotId } },
      { session }
    );
  });
} finally {
  session.endSession();
}

// Outside the transaction, after commit: waitlist-notify fires only if the old slot
// actually became available — never inside the transaction, never on the cancelled branch
if (oldSlotOutcome === 'available') await waitlist.notify(oldSlotId);
```

**Interview-ready explanation of why these two use different mechanisms:** plain booking is a single-document state transition, so an atomic conditional update is simpler and faster than a full transaction. Reschedule inherently spans two documents that must change together or not at all — that's exactly the case a transaction exists for. Using a transaction for both would be unnecessary overhead on the hot path (booking); using a conditional update for reschedule would risk one slot changing without the other.

### 4d. A third transactional case: business creation

Signup creates two cross-referencing documents at once — `Business` (`ownerId` → the new user) and `User` (`businessId` → the new business, `role: 'owner'`). Since customers never get a `Users` row and staff accounts are created by owner-invite, this is the *only* path that produces an owner account — signup **is** business creation, not a later step attached to a pre-existing user.

Without a transaction, a duplicate-email collision (an ordinary, common signup failure, not a rare edge case) leaves an orphaned document on whichever write succeeded first — a `Business` no one can log into, or a `User` pointing at a `Business` that doesn't exist. That's the same shape of problem as reschedule: two documents that must succeed together or not at all.

The mechanic: pre-generate both ObjectIds (`userId`, `businessId`) *before* any write, then insert both documents — already fully cross-referenced — inside one `session.withTransaction`. This avoids an insert-then-update sequence that would briefly leave a document in a half-formed state, and it means the session (which needs `businessId` to resolve on the very first authenticated request, Section 9) and any side effects (a welcome email) are only issued/created **after the transaction commits**, never before or during it.

Pre-validating email uniqueness and generating a slug (kebab-cased from the business name, with a numeric-suffix fallback on collision, e.g. `mikes-barbershop-2`) before attempting any writes gives a fast, friendly error on the common case — but this is UX only. It doesn't close the race (another signup could land between the check and the insert), so the transaction plus MongoDB's own unique indexes (`Users.email`, `Businesses.slug`) remain the actual correctness guarantee, not the pre-check. **On a genuine concurrent collision** (two signups generating the same candidate slug at the same instant, both passing pre-validation since neither sees the other's uncommitted insert), the losing transaction aborts on the unique `slug` index — the API catches specifically that failure mode and automatically retries the whole transaction with a new candidate slug, bounded to a small retry count, invisible to the user in virtually every real case. This is deliberately narrower than "retry on any transaction failure": a duplicate-*email* collision at commit time must **not** auto-retry — there's no alternate identity to substitute, it's a real "this email is already registered" error.

Explicitly out of scope for MVP: ownership transfer. `Business.ownerId` is fixed at creation; there's no flow for transferring a business to a different owner.

### 4e. Transaction boundaries — the general rule

Across every case in this section (reschedule, business creation, and Section 9b/2c's staff removal, resource retirement, invitation acceptance, service deactivation): **a transaction is required only where two or more documents must succeed or fail together as a single logical unit.** This is narrower than "every operation that touches multiple documents" — `generate-weekly-slots` (Section 6) inserts many independent `Slot` documents across many providers in one run, but none of those inserts share a joint success/failure requirement with any other, so wrapping the whole run in one transaction would create real, unjustified lock contention for zero correctness benefit. It is not wrapped in a transaction; each insert is independently idempotent instead (Section 6).

**No transaction in this design ever contains an external call** — no Redis, no BullMQ enqueue, no email send, no Socket.IO emit, no outbound HTTP. Every transaction here is pure MongoDB reads/writes on a session; every external side effect (token-email enqueue, waitlist notification, realtime emit, session issuance) happens strictly *after* the transaction commits. This isn't incidental — an external call inside a multi-statement transaction can't be rolled back if a later step fails, and it holds the transaction's locks open for however long that call takes, which is exactly the kind of contention a transaction should be kept small to avoid.

---

## 5. Redis usage — what lives where, and why

| Data | Lives in | Why |
|---|---|---|
| Slot's durable status (`available`/`confirmed`/etc.) | MongoDB | Source of truth, must survive restarts, queried in complex ways |
| "Currently being booked" hold with auto-expiry, plus the `sessionId`/`holdVersion` pair needed to authorize and fence a confirmation (Section 4) | Redis (`SET hold:slotId {sessionId, holdVersion} EX 300 NX`) | Ephemeral, needs automatic TTL expiry — exactly what Redis is for, awkward to replicate in Mongo without a cron job. `holdVersion` here is a copy of the same value stored on the `Slot` document — Redis and Mongo both know it, the client never does. |
| Dashboard aggregate counts (today's bookings, upcoming count) | Redis cache, invalidated on write | Read-heavy, cheap to cache, doesn't need to be live-exact to the millisecond |
| Rate limit counters (public booking endpoint, and independently, login per-account/per-IP — Section 9) | Redis | Needs atomic increment + expiry, standard use case |
| Staff/owner session records (`userId`, `issuedAt`), keyed by opaque session ID, sliding TTL (Section 9) | Redis | Same ephemeral-with-TTL shape as holds — authoritative, not a cache; a Redis outage now also blocks staff/owner login, an accepted extension of an already-hard dependency |

**Note:** the *actual* atomicity guarantee for booking comes from Mongo's `findOneAndUpdate` (Section 4), not from Redis. Redis's hold is a **UX nicety** (shows "someone else is looking at this slot" / reserves it briefly during checkout), not the correctness mechanism — worth being precise about this distinction in an interview, since conflating "Redis lock" with "the thing that actually prevents double-booking" is a common and telling mistake.

---

## 6. Queue architecture (BullMQ)

```
Jobs:
  - send-transactional-email (triggered on booking/cancel/reschedule, sends confirmation /
                               cancellation emails — each includes the magic-link access
                               token, see Section 9a. removeOnComplete + removeOnFail both
                               configured, since a token-carrying job's outcome should never
                               be silently discarded on either path)
  - send-reminder-email      (scheduled, fires 24h and 1h before appointment; if a booking
                               is created inside one of those windows, the reminder whose
                               fire-time has already passed is simply not scheduled — no
                               "send immediately" catch-up logic. If enqueue itself fails,
                               there is no "resend reminder" feature — an accepted, low-stakes
                               silent-loss risk, since the customer's actual booking/access is
                               entirely unaffected, only a convenience reminder is lost.

                               Jobs are treated as potentially-stale and self-validating,
                               never authoritative — cancel does NOT delete a booking's
                               pending reminder jobs, and reschedule does NOT delete or locate
                               the old jobs either; both simply enqueue fresh jobs for the new
                               schedule where applicable and leave the old ones dangling. Every
                               worker execution re-reads authoritative Mongo state before
                               sending: requires Booking.status === 'confirmed' AND the
                               Booking's currently-resolved Slot.datetime matches the datetime
                               this job was scheduled against — either check failing is a
                               silent no-op, never an error, never a retry. This single check
                               correctly self-suppresses a cancelled booking's reminders, a
                               rescheduled booking's stale-datetime reminders, and any
                               combination of the two, with no job-ID tracking or
                               queue-management logic introduced into the bookings domain.
                               Fixed-duration-before-a-UTC-instant scheduling (not "same
                               wall-clock time yesterday") makes this DST-safe by
                               construction, unlike weekly slot generation (Section 6, below).

                               Accepted residual risk, not silently assumed away: because old
                               jobs are never deleted, a booking rescheduled more than once
                               that happens to cycle back to a previously-used exact datetime
                               (e.g. A → B → A again) can have two dangling jobs — one from
                               each time A was the active schedule — both correctly validate
                               against the same, currently-true state and both send. This is a
                               narrow, low-stakes notification-duplication risk (Section 6's
                               general notification policy, below), not a Booking/Slot
                               correctness problem, and no scheduleVersion/dedup field is
                               added to close it for MVP.)
  - process-hold-expiry      (repeatable, sweeps expired Redis holds back to 'available',
                               clearing holdVersion to null in the same write — a periodic
                               backstop, not the only path back to 'available': the
                               claim-triggered lazy release (Section 4) handles the common
                               case immediately, this job catches whatever a claim never
                               happens to touch. Both are holdVersion-scoped conditional
                               writes, so they never conflict with each other)
  - waitlist-notify          (triggered on a Slot's confirmed → available transition —
                               whether from a plain cancel or a reschedule's old-slot release
                               (Section 3), never from confirmed → cancelled. Advisory only:
                               tells the next matching entry "this slot is available right
                               now," not an exclusive claim — there is no reservation state,
                               the notified candidate claims through the exact same public
                               atomic mechanism as anyone else and can lose the race to a
                               faster claimant. Re-verifies status: 'available' immediately
                               before notifying, since the slot may already have been claimed
                               by the time this job runs (staleness protection). Matching
                               rule: entries with the slot's serviceId, ordered by createdAt;
                               an entry with a desiredProviderId only matches a slot from that
                               exact provider, an entry with no provider preference matches a
                               slot from any provider offering that service. A failed enqueue
                               here silently misses that one opportunity, but the waitlist
                               entry persists and is picked up by the next matching opening —
                               not a permanent loss, consistent with "advisory only". On
                               successful notify, the entry moves to 'notified' and a
                               *delayed* follow-up job (waitlist-expire-check, fixed delay,
                               e.g. 15 min) is scheduled for that same entry. When it fires:
                               if the slot is still 'available', this candidate didn't act in
                               time — mark the entry 'expired' and repeat the matching/notify
                               step for the next entry in line (same mechanism, recursively).
                               If the slot is no longer 'available', mark the entry
                               'converted' — an approximation, not a certainty (nothing links
                               an anonymous claim back to a specific notified entry, since
                               customers have no accounts), but a wrong label here has no
                               functional consequence: either way this entry stops being
                               actionable, which is the only thing that matters)
  - generate-weekly-slots    (scheduled, generates next week's Slot documents from each
                               provider's ProviderAvailability template — staff and resources
                               alike, one Slot per unit of capacity for resource providers.
                               Idempotent: for each (providerId, datetime, unitIndex) the job
                               checks whether a Slot already exists before inserting, so
                               re-running it — a retry, a manual trigger — never creates
                               duplicates. Always inserts status: 'available' — this job never
                               creates a Slot in any other state. Each Slot.datetime is
                               computed by converting ProviderAvailability.startTime on the
                               target calendar date from Business.timezone to a UTC instant
                               via a DST-aware conversion (e.g. Luxon/date-fns-tz), never
                               fixed-offset arithmetic — a fixed offset would silently
                               misplace slots across a DST boundary for any business in a
                               DST-observing zone.

                               For each provider, immediately before inserting: re-checks the
                               provider is still active (Users.status / Resources.status) AND
                               the service is still active (Services.isActive) — the template
                               read at job start could otherwise be stale relative to a
                               concurrent removal/retirement/deactivation. Immediately after
                               inserting, re-checks again, and if the provider or service
                               became inactive in that narrow window, deletes the just-inserted
                               slot(s) with a *conditional* delete — deleteOne({ _id,
                               status: 'available' }), never an unconditional delete by _id.
                               The condition matters: if a customer claimed the slot in the
                               instant between insert and this check, the delete correctly
                               no-ops rather than destroying their legitimate hold — the
                               filter can never match a held or confirmed slot, so this
                               compensating step can never delete a real booking. This
                               pre+post check narrows the generation-vs-removal race
                               significantly but does not mathematically eliminate it — the
                               remaining window requires a rare human action (removal,
                               retirement, deactivation) to coincide almost exactly with this
                               job's per-provider processing instant, and the worst case is
                               already caught by Section 9b's "confirmed bookings tied to a
                               removed provider are surfaced for manual handling" process)
```

Why queued rather than done inline: transactional/reminder emails and slot generation are not something a customer's booking request should wait on — they're enqueued and processed by a worker independently, keeping the booking API's response time fast and predictable regardless of email provider latency.

**Retry/backoff policy — every job uses BullMQ's standard bounded retry, not an unlimited or hand-rolled one.** A small, fixed number of attempts (BullMQ's own default shape: a low attempt count with exponential backoff between them) applies uniformly to every job in this list. The exact attempt count and backoff base are a tuning parameter, not an architectural decision — nothing about correctness anywhere in this design depends on the specific number, because every job that touches domain state already re-validates itself before acting (the reminder job's status/datetime check, the AI job's compute-once guard, Section 10) or is naturally idempotent (`generate-weekly-slots`, Section 6 above). What *is* architectural, and already locked, is the shape of the guarantee this bounds: retries make duplicate delivery *possible*, never guaranteed-eventually — a job exhausting its bounded attempts simply stops, consistent with the project-wide best-effort delivery policy (Section 8) rather than retrying forever to force a delivery guarantee this project deliberately doesn't build.

**A second class of accepted, low-stakes silent-loss risk:** the business-creation welcome email (Section 4d) has the same shape as the reminder email above — if its enqueue fails, there is no resend feature for it either, but the owner's account and login already work regardless, so nothing functionally important is lost.

---

## 7. Real-time architecture (Socket.IO)

- Customers viewing a business's public booking page join a room scoped to that business (`business:${businessId}`)
- On any slot status change (held/confirmed/cancelled), the server emits to that room only — **tenant-scoped rooms**, so Business A's customers never receive Business B's events (a real, checkable multi-tenancy correctness point)
- Staff dashboard joins the same room, sees live bookings come in

```js
// Staff (capacity 1): a plain status flip is enough to update that one row in the UI
io.to(`business:${businessId}`).emit('slot:updated', { slotId, status });

// Resource with capacity > 1 (Section 4b): the UI shows a remaining count per time
// bucket, not per anonymous unit, so the emit carries the recomputed count instead
io.to(`business:${businessId}`).emit('slot:updated', { providerId, datetime, remaining });
```

**Realtime is best-effort, with no retry and no delivery guarantee** — it is a live-update convenience layer, never a source of truth. A client that misses an emit (a dropped connection, a missed reconnect window) simply shows slightly stale data until its next normal HTTP fetch/page load, which always reflects true database state regardless of what Socket.IO delivered. Nothing depends on an emit actually arriving.

---

## 8. Notification system (MVP scope: email only)

```
Trigger → enqueue BullMQ job → worker sends via email provider → log delivery status
```

- Booking confirmation (immediate) — includes the magic-link URL for self-service manage (Section 9a)
- Reminder (24h and 1h before, scheduled jobs) — also includes the magic-link URL, so a customer can cancel/reschedule straight from the reminder
- Cancellation confirmation
- Waitlist "a slot opened up" notification (time-boxed — if not claimed within N minutes, moves to the next person in line)

SMS/push explicitly out of scope — noted as a "would add NotifyHub-style multi-channel delivery here in a real product" talking point, not built.

**Project-wide notification delivery policy: best-effort, no exactly-once machinery.** Applies uniformly to every notification type above (confirmation, cancellation, reschedule, reminders, waitlist): jobs are always enqueued strictly after the relevant transaction commits (Section 4e), never inside it. No transactional outbox, no notification-sent ledger, and no deduplication infrastructure exists for MVP. Both duplicate delivery (a worker retry/crash after a successful send, or the reminder-cycling case above) and delivery loss (an enqueue call itself failing post-commit, with no resend mechanism) are accepted MVP risks — described precisely as "best-effort delivery; duplicates and silent loss are accepted risks," never as strict "at-least-once," since neither guarantee is actually built. This is a deliberate, project-wide scoping decision, not an oversight case-by-case: nothing about Booking/Slot correctness ever depends on notification delivery — the Mongo conditional writes (Section 4) are what actually prevent double-booking; notifications are purely informational, and a notification being sent never reserves a Slot or otherwise affects booking correctness. Workers still validate current authoritative state before sending wherever already specified (reminders and waitlist-notify, above) — that's a staleness-suppression check, not a delivery guarantee.

---

## 9. Multi-tenancy & RBAC

- Every business-scoped collection carries `businessId`; every query is filtered by it — enforced in middleware, not repeated manually per-route, to reduce the chance of a forgotten filter
- **Two structurally distinct actor categories, not three peer "roles."** `Users.role` is `'owner' | 'staff'` only (Section 2) — `owner` manages the business, staff, services, and resources; `staff` has full business-wide visibility and management of bookings, providers, and services, **not** scoped to only their own `providerId` (an intentional MVP simplification — a narrower "providers see only their own bookings" model solves a large-team privacy problem this small-team MVP doesn't have). Customers are never represented in `Users` at all and have no role value — they're identified by `businessId + contactType + normalizedContact` (Section 2/9a) and authenticated through an entirely separate token-verification path (magic link, Section 9a), never through a session or a role check. RBAC middleware therefore has two genuinely different code paths, not one unified "check the role" mechanism with a third branch: session-based checks (below) for staff/owner requests, and magic-link token verification for customer requests.
- **Staff provisioning:** an owner invites staff by email (Section 9b) from the owner dashboard — this is the *only* path to a staff account. Staff never self-register, and there is no owner-set-password flow either — both would let account creation happen without the invitee ever proving control of the email address they're being onboarded with.
- **Owner acting as a provider:** for a solo/owner-operated business, the owner's own `Users` row (role `owner`) can be referenced directly as `providerId`/`providerType: 'staff'` on `ProviderAvailability`/`Slots` — no separate staff account is required just to make the owner bookable.
- **Server-side enforcement only** — a hidden button in the UI is not access control; every mutating route re-checks role + businessId match against the authenticated user, never trusts client-side state. Critically, this check is never a separate step before the mutation — `businessId` is part of the *same* query filter as the write itself (Section 4c), not a pre-check that could go stale between the check and the act.
- **Staff lifecycle management is owner-only.** Only `role === 'owner'` may invite, remove, reactivate, or otherwise act on a staff account (Section 9b) — there is no delegated "manager" tier in MVP, matching the project's actual scale rather than an unscoped privilege hierarchy. A cross-cutting invariant, enforced everywhere a `User`'s status could change, not just inside the staff-lifecycle module: no code path may ever set the business's sole owner's own status to non-active. This is guaranteed structurally, not just by convention — exactly one `User` document per business ever has `role: 'owner'` (Section 2/4d), created only at business-creation time, with no ownership-transfer path (Section 4d) and no path that ever creates a second owner — so "an owner acting on another owner" or "the last owner locking themselves out" are unreachable by construction, not scenarios a runtime guard has to catch.

### Staff/owner authentication: server-side sessions, not JWT

Staff and owner accounts authenticate via a **cryptographically random opaque session ID in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie**, with the authoritative session record stored in **Redis, keyed by that ID, with a TTL** — not a JWT. Redis was already a hard dependency for booking-hold concurrency (Section 5); this extends it to authentication as well, rather than adding a second, parallel auth mechanism. (Customer authentication remains the separate magic-link token/cookie flow in Section 9a — unaffected by any of this.)

**Why `SameSite=Strict`, not `Lax`.** Under the locked same-origin deployment (Section 14), there is no legitimate scenario where this cookie ever needs to survive a cross-site top-level navigation — staff/owner reach the dashboard by navigating to it directly, not by following an inbound link from another site the way a customer follows a magic link. `Strict` is therefore strictly safer with no real UX cost here, and it matches the customer magic-link cookie's `SameSite=Strict` (Section 9a) for one consistent rule rather than two different cookie policies to reason about.

- **What the session record holds, and what it deliberately does not.** The Redis session stores only `userId` and `issuedAt` (UTC, millisecond precision) — never a cached `role`, `businessId`, or `status`. Every authenticated request resolves the session's `userId`, then reads the current `User` document fresh from Mongo by `_id` (a cheap indexed single-document lookup) for `role`, `businessId`, and `status`, exactly the same "verify authoritative state, don't cache it" discipline already used for holds, reminders, and provider eligibility. A request is rejected if `status !== 'active'` (a removed staff member loses access on their very next request, not at some future token expiry), or if `issuedAt` predates `User.passwordChangedAt` or `User.sessionsInvalidatedAt` (either one alone invalidates the session; see "Password change and stolen-session recovery," below).
- **Session ID generation and fixation.** Login always mints a fresh, newly-generated random session ID and Redis key — never reuses or extends whatever cookie value (if any) was already present in the request. This closes the standard session-fixation vulnerability class (an attacker planting a known session ID in a victim's browser before they log in) at negligible cost.
- **TTL: 7-day sliding idle timeout, no absolute cap for MVP.** Refreshed only by authenticated HTTP activity — an open browser tab or an established Socket.IO connection alone does **not** refresh it (Socket.IO auth is checked at handshake/reconnect, not continuously). When the session expires, the next authenticated request or socket reconnect simply requires login again. `issuedAt` is stored regardless, both for the `passwordChangedAt` comparison above and to keep a later absolute-cap addition a pure config change with no data migration.
- **Multiple concurrent sessions per user are explicitly allowed** — logging in from a second device doesn't evict the first. No single-session-per-user enforcement, and no reverse index enumerating a user's active sessions, for MVP; deliberately not built rather than overlooked, since nothing about this project's scale needs it.
- **Logout** deletes the Redis session outright. **"Log out everywhere"** is a separate, explicit action: it stamps `User.sessionsInvalidatedAt` to the current UTC time, which invalidates every session issued before that instant — including the one that triggered it, so the triggering request completes successfully and the frontend redirects to login rather than attempting any further authenticated call on that now-dead session. This is the account owner's recourse for a suspected stolen session (a lost/compromised device) without needing to also change their password. An already-established Socket.IO connection is **not** force-disconnected by either logout or "log out everywhere" — it is revalidated (and rejected, if invalidated) only at its next handshake/reconnect. This is an explicit, accepted bounded MVP limitation, not an oversight: building per-user socket tracking and forced disconnection is real additional infrastructure this project's scale doesn't need, and the exposure is bounded by however often reconnects naturally happen.
- **Password change and stolen-session recovery.** `passwordHash` and `passwordChangedAt` are written together in a single Mongo document update (never two separate writes), so there is no window where a new password is stored but an attacker's session from before the change is still valid. This, together with `sessionsInvalidatedAt` above, is the project's full stolen-session-recovery story — no individual-session listing/revocation UI and no per-user Redis reverse index for MVP.
- **Password hashing: bcryptjs, cost factor 12.** Passwords are never stored plaintext; login compares via the library's `compare()` function only, never a manual string comparison (bcrypt's compare is what avoids a timing side-channel). The complete bcrypt hash string is stored as-is, so its cost parameter travels with it for a future rehash-on-login upgrade path with no schema change. This is a deliberate deployment/simplicity trade-off, not a claim that bcrypt is inherently more secure than Argon2id: Argon2id is the stronger modern choice, deferred specifically because `bcryptjs` is pure-JS with no native-addon build step, removing a class of deploy-time failure on a not-yet-fixed hosting target (Section 13) at negligible cost for this threat model. Password hashing/comparison lives only in the auth/identity module — every account-creation path (owner signup, staff-invitation acceptance) calls the same shared function, never a separate implementation. Passwords never appear in logs, API responses, Redis sessions, emails, or any other persisted record.
- **Login rate limiting: independent per-account and per-IP Redis-backed limits.** Per-account: 5 consecutive failures locks that account out for 15 minutes, reset only by that account's own successful login (never by an unrelated account's success on a shared IP). Per-IP: a separately-configured, more generous threshold/window catches high-volume automated abuse (e.g. credential stuffing across many different accounts from one source) that per-account limiting alone would miss, decaying only via its own TTL. The increment, threshold evaluation, and lockout creation are one atomic Redis operation (a Lua script or equivalent) — never check-then-increment, which would leave a race window for concurrent attempts to slip past the threshold. Accounts are never permanently locked. Rate-limit responses never reveal whether an account exists; a login attempt against a nonexistent account still runs `bcrypt.compare()` against a fixed dummy hash rather than skipping the work, so response timing can't be used to enumerate valid accounts either. If Redis is unreachable, login fails closed (a plain `500 INTERNAL_ERROR`, Section 13) rather than silently disabling the protection — consistent with, not an addition to, Redis already being a hard authentication dependency. Rate limiting applies only to the login endpoint; authenticated requests are governed entirely by the session rules above.
- **Socket.IO authentication and channel scoping.** A Socket.IO connection authenticates using the same session cookie at handshake and reconnect, validated against Redis and the fresh Mongo `User` read exactly like an HTTP request. The business (and, for a customer's own booking-specific channel via Section 9a, the booking/access-token) a connection is subscribed to is always resolved **server-side from the authenticated session** — never from a client-supplied `businessId`, `customerId`, `bookingId`, or room identifier, which would otherwise let a malicious client attempt to subscribe to an arbitrary tenant's or customer's channel by simply naming it. The same response-projection rules that govern REST payloads (Section 13) apply identically to every emitted Socket.IO event.

### 9a. Customer self-service (magic link)

Customers have no account, so booking management can't go through normal login. Each `Booking` carries a credential scoped to that one booking only — not a customer-level identity, not something that unlocks a customer's other bookings. If it leaks (a forwarded email, a shared inbox), the damage is contained to one low-stakes appointment, not a customer's entire history.

**Token generation and storage.** The raw token is `crypto.randomBytes(32)` (256 bits), base64url-encoded, generated at booking-confirmation time and emailed once. The database stores only `accessTokenHash = SHA-256(token)` (Section 2) — the raw value is never persisted. Two distinct properties are doing two different jobs here, worth keeping separate: **entropy** (256 random bits) is what makes the token practically unguessable and collision-free — that's the actual security mechanism. The `accessTokenHash` **unique index** is defense-in-depth against an implementation bug (a broken RNG, an accidental reuse), not the reason the system is secure — if that index ever actually rejected an insert for a real collision, something would already be badly wrong upstream.

SHA-256 (not bcrypt/Argon2) is the correct hash here, for a reason worth being precise about: bcrypt/Argon2 exist to slow down brute-forcing *low-entropy, human-chosen* secrets like passwords. A 256-bit random token has no feasible guess space regardless of hash speed — using a deliberately slow hash would add latency to every link click for zero security benefit.

**The raw token must never reach any log, anywhere — this extends the same reasoning that already keeps it out of the URL.** POSTing the token in the request body rather than a URL query string (below) already avoids the most common leak path (proxy/access logs capturing full request URLs by default), but that protection is void if the application's own logging then turns around and logs full request bodies — a common default in request-logging middleware set up for debugging. The same rule applies to `StaffInvitations.tokenHash`'s raw counterpart (Section 9b, identical token model): request/access logging must never include the raw token value, whether it would otherwise appear via URL, request body, or headers. Only the hash is ever safe to log, since the hash is exactly what's already stored at rest.

**Token exchange, not a token sent with every request.** On first load, the frontend `POST`s the raw token (in the request body, never a URL query string) to an exchange endpoint, which verifies it against the stored hash and, on success, issues a short-lived (1 hour) signed cookie — `HttpOnly`, `Secure`, `SameSite=Strict`, scoped to that one `bookingId`. The frontend immediately scrubs the token from the visible URL via `history.replaceState`. Every subsequent view/cancel/reschedule call authenticates via that cookie, not the raw token. This matters because a token living in a URL is a real, well-documented leak vector in practice — reverse-proxy/access logs commonly capture full request URLs by default, and the `Referer` header hands the full URL (token included) to any third-party script or image the page loads. Exchanging once for a cookie and cleaning the URL closes both of those without inventing a new auth system — it's the same signed-cookie primitive already used for staff/owner sessions, pointed at a different login method.

**Access is authorization only — never a second path through the booking engine.** The manage route resolves a valid cookie to exactly one `bookingId` and nothing else. Every mutation after that calls the *same* `bookings.cancelBooking()` / `bookings.rescheduleBooking()` functions the staff dashboard calls — there is no parallel "customer path" through the state machine, the atomic conditional write, or the reschedule transaction. The magic link answers "who," never "what's allowed."

**Three access tiers, driven by two independent clocks:**

| State | View | Cancel / reschedule |
|---|---|---|
| Before `cancellationCutoffMinutes` (Section 3) | ✅ | ✅ |
| Past the cutoff, before token expiry | ✅ | ❌ (server rejects with a clear "contact the business directly" message, not a 500) |
| Past `accessTokenExpiresAt` | ❌ | ❌ |

`accessTokenExpiresAt = booking.slot.datetime + 7 days` — a **fixed application constant, not a `Business` setting** (unlike `cancellationCutoffMinutes`, there's no clear business reason different businesses would want different credential lifetimes; this is a security/UX default, not a policy lever). It's calculated from the *appointment's* datetime, not booking-creation time — a flat offset from creation would let a link expire before a far-future appointment even happens — and it's recomputed against the new slot automatically whenever a booking is rescheduled, since it's read live rather than frozen.

**These tiers are purely time-based and deliberately independent of `Booking.status`.** A cancelled, completed, or no-show booking stays viewable under the exact same time rule as a still-confirmed one — there's no reason to hide a customer's own history of what happened. Mutation attempts on a non-`confirmed` booking are always rejected regardless of tier, but that's enforced by the underlying `cancelBooking()`/`rescheduleBooking()` functions themselves (Section 3's terminal-state rule), the same functions staff/owner routes call — the tier logic never needs its own copy of that check, it only ever needs to know about time.

**Losing the link.** A customer can request a fresh one by submitting their contact info. The response is always the same neutral message ("if a matching booking exists, a link has been sent") regardless of whether a match was found, to avoid turning this into an email/phone enumeration endpoint — the same pattern any "forgot password" flow uses. Rate-limited by both IP and the normalized contact value being requested, since IP-only limiting doesn't stop enumeration from a botnet. Reissuing a token invalidates the old one immediately — only the latest credential is ever valid, which bounds the exposure of an old, possibly-leaked link.

**If a customer has multiple upcoming bookings, resend links the soonest one.** This is a deliberate, minimal choice: resend is a *fallback* recovery path, not the primary way customers reach their bookings — each booking already gets its own independent link at creation time, sent directly to the customer, so resend only matters when one of those original emails is lost. Given that, defaulting to the soonest upcoming booking for the fallback case is reasonable; a customer who specifically needs a non-soonest booking's link and has also lost that original email too is a rare, compound case handled by contacting the business directly, not by building a "list all my bookings" feature this project has no other need for.

**A customer with no email on file has no magic link and no self-service access at all** — not a degraded version of it. Phone-only bookings can still be made and are still fully manageable by staff/owner through the normal authenticated routes; the customer simply has no independent way to view or change it themselves. This is the direct, intended consequence of email being optional (Section 2) rather than a gap — there is no secondary, non-email self-service mechanism to fall back to.

### 9b. Staff invitation & removal lifecycle

Staff accounts are never self-registered (Section 9) — the only path to a staff `User` document is through this lifecycle. It's kept deliberately separate from Section 9a's customer magic link even though both use the same token mechanics, because they authorize fundamentally different things: a customer link authorizes viewing/mutating one booking; an invitation authorizes creating a real, credentialed account.

**Invitations are a separate collection, not a pending `User` row.** Same reasoning as keeping `Slots` and `Bookings` separate (Section 2): an invitation's existence is independent of whether a `User` account ever results from it. A pending-`User` approach would force every `User` row to carry transient workflow fields and would mean something in `Users` represents a person who hasn't proven they want to join yet — `Users` should mean exactly one thing: a real, loginable account.

```
StaffInvitations
  - _id, businessId (ref)
  - email (normalized — lowercase + trim, before storage AND before every comparison;
    the same normalization function is used for Users.email uniqueness, this collection's
    uniqueness, the existing-email rejection check, and duplicate-invitation detection —
    one rule, used everywhere email is a key)
  - tokenHash (string, indexed)      # SHA-256 of the raw invitation token — same
                                       # generation/hashing model as the customer magic
                                       # link (Section 9a): crypto.randomBytes(32),
                                       # raw value emailed once, never persisted
  - expiresAt
  - status: 'pending' | 'accepted' | 'revoked' | 'expired'
  - invitedBy (ref → Users)
  - createdAt, acceptedAt (nullable)
```
Unique index: `{businessId, email}` — one invitation record per business+email, reused across resends rather than accumulating rows.

**Three distinct collision cases when an owner tries to invite an email — do not conflate them:**
1. **The email matches an existing `User`, active or removed, at this business or any other.** Invite creation is rejected outright, with no exception for a removed account at the same business — reactivation (below) is a separate, explicit action, never an implicit side effect of creating an invitation.
2. **The email has an existing `pending`, `expired`, or `revoked` invitation at this business.** Treated as an implicit resend: the existing row's token is regenerated and its `expiresAt` refreshed, no second row is created (the `{businessId, email}` unique index makes this the only possible outcome).
3. **The email has an `accepted` invitation at this business.** A `User` already exists — this is case 1, not a resend.

**Resend and the terminal `accepted` state.**
```
pending ──► accepted        (terminal — a User now exists, resend no longer applies)
pending ──► expired / revoked
expired / revoked ──(resend: new token, new expiresAt)──► pending
```
Resend is valid from `pending`, `expired`, or `revoked` — never from `accepted`. Each resend invalidates the previous token immediately, so only the latest link is ever live, same discipline as the customer magic link's resend (Section 9a).

**Acceptance is a transaction — the fourth case of the pattern established in Section 4d.** The invitee opens the link, the raw token is verified against `tokenHash`, they set a password, and in **one Mongo transaction**: the invitation is conditionally marked accepted — `findOneAndUpdate({ _id, tokenHash, status: 'pending', expiresAt: { $gt: now } }, { $set: { status: 'accepted', acceptedAt: now } })`, the same conditional-write discipline used everywhere else in this design — and only if that update succeeds does the `User` document get created (`role: 'staff'`, `status: 'active'`, `businessId` from the invitation). A concurrent revoke or an already-passed expiry causes the conditional update to simply not match, aborting the whole transaction before any account is created. A normal login session is issued only after commit. This mirrors business creation exactly — two documents that must succeed together, or a used token could leave the system in an inconsistent state relative to whether an account actually exists. **The `User` row is created only here** — nothing in `Users` represents an invitee before acceptance. **`Users.email`'s existing unique index is the final backstop** against a concurrent race where a `User` with the same normalized email is created by some other process in the gap before this transaction runs — the `User` insert would hit that unique index and fail, aborting the entire transaction (including the invitation's conditional accept, which rolls back to its prior state) rather than leaving anything half-formed.

**Expiry is checked lazily**, at link-open time (`now > expiresAt`) — no background sweep, same approach as the customer magic link. **Revocation** is an owner action on a `pending` invitation (`status → 'revoked'`); an invitee hitting an expired or revoked link sees the same generic "this invitation is no longer valid" message either way.

**Removal is a soft state change on `Users`, never a hard delete** — a hard delete would orphan every historical `Booking`/`Slot` that references the row as `providerId`, breaking exactly the invariant Section 2b's provider-existence check is meant to protect. `Users.status: 'active' | 'removed'` — two states, deliberately not four; nothing in this project drives a need for a separate, reversible `suspended` state distinct from removal, consistent with every other "don't build a state without a concrete use case" decision made in this design (multi-business, multi-provider bookings, etc.).

**Removal touches three pieces of state that must move together, in one transaction:**

| Mutation | Effect |
|---|---|
| `Users.status → 'removed'` | Login blocked; fails the provider-eligibility predicate (Section 2b) from this point on — no separate "provider active" flag needed, since that predicate already reads `Users.status` live |
| `ProviderAvailability` deactivated | No new `Slots` generate for this provider going forward |
| Future `available` **and `held`** `Slots` cancelled | `available` slots: nothing lost, no customer holds a claim. `held` slots: a customer's in-flight checkout is invalidated (`holdVersion` cleared to `null`, Section 4) rather than left to expire naturally — a hold on a provider actively being removed should not be confirmable |

Without the transaction, a removed staff member's stale `ProviderAvailability` could keep generating bookable slots after their account is already gone — exactly the inconsistency this grouping prevents. **Confirmed slots are deliberately left out of this cascade** — see "What removal deliberately does not touch," below.

**What removal deliberately does *not* touch:** confirmed future bookings tied to the removed provider are left alone — not auto-cancelled, not auto-reassigned. Reassignment requires matching a replacement provider's skill and availability, which is real scope beyond this MVP. Instead, these are surfaced to the owner as a manual follow-up list. Historical (past) bookings are untouched and continue to display correctly, since the `User` row persists indefinitely — only its `status` changes. **Every operation on these bookings remains fully legal regardless of the provider's status** — the customer can still view/cancel/reschedule via their magic link (subject to the ordinary cutoff), and staff/owner can still cancel, mark completed, or mark no-show (Section 3's actor table) — "removed" means *not currently bookable*, never *historically invalid*.

**Reactivation** is a distinct, explicit owner action, usable only against a `removed` `User` at the same business: it flips `status: 'removed' → 'active'` on the existing row. It never creates a second `User` for that email, and it is never triggered implicitly by creating an invitation (case 1 above). **It does not touch `passwordHash`** — the account's previous password remains valid after reactivation. This is an explicit, named MVP security/product tradeoff, not an oversight, consistent with forced-password-reset-on-reactivation already being an explicitly deferred item (below). It also does not restore `ProviderAvailability` (already hard-deleted at removal, Section 2b) — the owner must explicitly reconfigure availability for a reactivated provider from scratch, same as setting it up for a brand-new provider.

**Two invariants this lifecycle does not touch:** becoming staff (accepting an invitation, being reactivated) never makes someone a provider — that's still a separate, deliberate act of creating `ProviderAvailability` for them, unrelated to onboarding. And the owner's own ability to act as a provider (Section 9) is entirely independent of this lifecycle — owners aren't invited, they're created at business-creation time (Section 4d).

**Explicitly deferred, not forgotten:** automatic reassignment or cancellation-with-notification of confirmed bookings tied to a removed provider; a `suspended` (temporary, reversible) staff state; a detailed invitation audit trail (resend counts/history beyond the current token and status); forcing a password reset on reactivation; denormalizing a staff member's name onto `Bookings`/`Slots` at booking time to protect historical display against a later profile change.

### 9c. Resource retirement — deliberately mirrors 9b, not a separate design

A `Resources` row's retirement (Section 2) uses the **identical** lifecycle just described for staff, field-for-field: `status: 'active' | 'removed'`, two states, no `suspended` tier. This isn't just reuse for convenience — it's the conclusion of a direct comparison: there is no principled asymmetry between "a staff member left" and "a resource was retired" (a turf being resurfaced, a room being repurposed) — both are simply "this provider is no longer available," and a resource carries no additional physical-world caution a staff removal doesn't already have.

**Retirement touches the same three pieces of state, in one transaction, with the same effects:**

| Mutation | Effect |
|---|---|
| `Resources.status → 'removed'` | Fails the provider-eligibility predicate (Section 2b) from this point on |
| `ProviderAvailability` deactivated | No new `Slots` generate for this resource going forward |
| Future `available` **and** `held` `Slots` cancelled | Same reasoning as staff removal — a hold on a resource actively being retired should not be confirmable, invalidated immediately (`holdVersion` cleared) rather than left to expire naturally |

**What retirement deliberately does not touch:** confirmed future bookings against the retired resource are left alone, surfaced to the owner as a manual follow-up list, exactly as with staff removal — no auto-cancellation, no auto-reassignment (matching a replacement resource is real scope beyond this MVP). Historical bookings remain fully legal to view/cancel/mark-completed/mark-no-show regardless of the resource's status.

**Reactivation** is a distinct, explicit owner action, flips `status: 'removed' → 'active'`, never restores the already-deleted `ProviderAvailability` — the owner reconfigures availability from scratch, identical to staff reactivation. Verified against the full set of races already traced for staff removal (Section 9b): retirement while available/held slots exist, retirement concurrent with slot generation (Section 6's pre+post-check-and-compensate mitigation applies identically, since it already checks `Resources.status` the same way it checks `Users.status`), retirement concurrent with a customer claim, and historical/reporting correctness — all resolve the same way, because it's the same mechanism, not a parallel one that merely looks similar.

---

## 10. AI feature (kept from original QueueLess, unchanged)

No-show risk scoring — Gemini 1.5 Flash free tier, reads aggregated customer booking history (past no-show count, lead time patterns), returns a plain-language risk note shown to staff/owner only, never to the customer. Falls back silently to "no risk data" if the API is unavailable, and that failure never blocks, delays, or alters the underlying booking operation in any way. Rate-limited to one computation per booking creation, not recomputed on every page view or on reschedule — the result is persisted on `Booking.noShowRiskNote` (Section 2) at creation time, so every later view of that booking reads the stored note rather than re-calling Gemini.

**Purely informational — never authoritative, never enforced.** The note never blocks, changes, prioritizes, or otherwise gates booking, cancellation, confirmation, or rescheduling; booking correctness and authorization remain entirely deterministic. There is no risk threshold, no enforcement policy, and no customer-facing explanation of the score for MVP.

**Computed asynchronously, strictly after commit — never inline with the confirmation response.** Scoring is enqueued as a background job the same post-commit way as any other notification (Section 6/8), triggered by every path that produces a confirmed `Booking` (customer self-service and staff/owner walk-ins alike) — the confirming HTTP request never waits on Gemini. `noShowRiskNote` is `null` immediately after booking creation and populates shortly after if/when the job succeeds, or stays permanently `null` on failure; there is no retry/backfill for a booking that missed scoring due to a transient outage. This also closes an apparent ambiguity in this section's earlier wording ("computed at booking-confirmation time" could otherwise read as synchronous, which would directly contradict AI never being load-bearing) — confirmation and creation are the same instant in this design (a `Booking` document never exists before it's confirmed), and scoring itself happens after, not during, that instant.

**Excluded from customer-facing responses at the serialization layer, not just the frontend display layer** (Section 13) — the customer-facing/magic-link response projection never includes this field at all, so it's never present in any response payload a customer's browser receives, regardless of what the frontend chooses to render.

**What the job checks before writing — and why it's a different check than the reminder job's.** The reminder job (Section 6) re-validates `Booking.status === 'confirmed'` and a datetime match before *sending*, because sending an incorrect reminder is a real, customer-visible harm. Writing `noShowRiskNote` has no externally-visible effect at all — no email, no notification, nothing triggered — so there's nothing equivalent to protect against by checking `Booking.status`. The one thing the write does need to protect is the "computed at most once" guarantee already locked above: the job's write is conditioned on the field still being unset — `Booking.findOneAndUpdate({ _id: bookingId, noShowRiskNote: null }, { $set: { noShowRiskNote: result } })` — never an unconditional `$set`. This is what makes a duplicate/retried scoring job a safe no-op (the second write's filter simply doesn't match once the first has landed) without needing any status re-check at all. A booking that's been cancelled or rescheduled by the time the job runs still safely receives its note — the note reflects the customer's history at booking time, remains accurate as that, and never recomputes or reacts to what happened to the booking afterward (already locked above: "not recomputed... on reschedule").

**Customer identity for this lookup:** since customers have no account, "the same customer" is matched by `customer.contact` (phone or email, whichever the business collects) across `Bookings` — and that lookup is always scoped to the current `businessId`. A customer's no-show history at one business never informs their risk score at another; there's no cross-tenant identity resolution, both because it isn't built and because doing it silently would be a privacy overreach for a project like this.

---

## 11. Development phases

| Phase | Weeks | Focus |
|---|---|---|
| **Phase 1 — Foundations** | Week 1 | Multi-tenant schema, auth/RBAC, business/service/provider (staff + resource) CRUD, deploy pipeline live from day 1 |
| **Phase 2 — Core booking engine** | Week 2 | Atomic booking (single-document), Redis holds, real-time slot updates, waitlist auto-fill. **Build together — this is the core interview story.** |
| **Phase 3 — Reschedule, cancellation, notifications** | Week 3 | Transaction-based reschedule, cancellation flow, BullMQ reminder jobs, AI no-show scoring |
| **Phase 4 — Polish & demo prep** | Week 3.5–4 | Rehearse concurrency demo (double-booking prevention) and reschedule demo, deploy hardening, README/architecture diagram |
| **Phase 5 — Stretch (optional, cut without guilt)** | If time remains | Basic analytics (today's bookings, no-show rate — simple aggregation, not a full dashboard system) |

---

## 12. How to present this project to an interviewer

**Don't lead with the feature list.** Leading with "it has bookings, staff management, notifications, waitlists..." makes it sound like a CRUD app with a long feature list — exactly what you're trying to avoid. Instead:

**Open with the problem, in one sentence:** *"I built a multi-tenant booking system where the core engineering challenge was guaranteeing that two customers can never book the same slot, even under concurrent load — and I extended that same correctness guarantee to rescheduling, which is actually the harder case."*

**Then go straight to a live demo, in this order:**
1. Show a normal booking flow once, quickly, so they have context (10 seconds)
2. **The money demo:** two browser tabs, same slot, click book on both simultaneously — one succeeds, one gets offered the waitlist instantly via the real-time update. Say out loud what's happening while it happens: "this is an atomic conditional write, not a check-then-write — there's no race window."
3. **The second demo, if they seem engaged:** reschedule an appointment, and explain that under the hood this is a transaction touching two documents — contrast it with the booking demo to show you understand *why* the mechanism differs (single atomic update vs. multi-document transaction), not just that you used "transactions" as a buzzword. **If they probe deeper on correctness**, the hold-confirmation fencing token (Section 4) is a good second-level story: a customer's stale, delayed confirmation request racing against a completely different customer's fresh hold on the same slot, closed with one extra field and no client-visible protocol change — a concrete example of finding and closing a real (if narrow) race rather than hand-waving it as "good enough."

**When they ask "why MongoDB, why not SQL":** be honest and specific — "I could have used Postgres and gotten transactions natively either way; I chose Mongo because the tenant-scoped, denormalized document shape mapped naturally to how I query by business, and I wanted to demonstrate I understand when a transaction is actually necessary (multi-document operations) versus when an atomic single-document update is sufficient and faster (the hot-path booking case) — using a transaction for everything would have been the less precise answer."

**If they push on scale ("what breaks at 100x traffic"):** give the honest, specific answer — the booking write path scales fine (it's O(1) per request, Mongo indexes the slot lookup), but the dashboard aggregate queries and the public booking page reads would need the Redis caching layer to take real pressure off Mongo, and Socket.IO would need to move off in-memory adapter to the Redis adapter for horizontal scaling across multiple server instances. Say what you *would* add, and why you didn't build it for a project with a handful of demo users — that distinction (knowing the next step vs. having built it) is itself a strong signal.

**If they ask "why not microservices":** this is the modular monolith payoff — "each feature module (bookings, notifications, availability) only talks to other modules through their exported functions, never by reaching into another module's database models directly. That means if a specific module ever needed to scale or deploy independently, the boundary's already there — I didn't reach for microservices on a project with a handful of concurrent users, because that complexity needs to be justified by an actual scaling need, not assumed upfront."

**What to explicitly say you scoped out, if asked:** analytics dashboards ("I deliberately kept this to a stretch goal — a real analytics feature needs its own design around pre-aggregation, and I didn't want to ship something shallow just to check a box"), multi-channel notifications ("email-only for this project; SMS/push would be the same architecture with an additional delivery channel in the notification worker, not a redesign"), multi-business ownership ("one user, one business for MVP — supporting multiple businesses per owner means a real membership/auth redesign, and nothing about this project's scope needs it"), and multi-provider bookings ("a booking always has exactly one provider — a driving lesson needing an instructor *and* a vehicle simultaneously is the same class of problem as a massage needing a therapist *and* a contended room, and building generic support for it would put a transaction on the booking hot path for a requirement I don't actually have"). Naming what you *cut and why* reads as more senior than pretending the project has no edges.

---

## 13. API response/error contract

**Envelope.** Every response is one of exactly two shapes: `{ data: <payload> }` on success, `{ error: { code, message, ...safe metadata } }` on failure. `code` is a stable, machine-readable string (e.g. `SLOT_NO_LONGER_AVAILABLE`); `message` is always safe to display directly to the caller — never a raw exception, stack trace, or database driver error. No endpoint returns a different shape.

**Status codes.** `400` validation, `401` no/invalid/expired session, `403` an authenticated caller lacking authorization *within their own tenant*, `404` a genuinely-missing resource **and** any cross-*principal* resource (see below), `409` state conflicts (`SLOT_NO_LONGER_AVAILABLE`, `HOLD_EXPIRED`, `BOOKING_ALREADY_CANCELLED`, `BOOKING_NOT_RESCHEDULABLE`, etc. — a pure HTTP-layer translation of the atomic-write failure signals Section 4 already produces, no new logic), `429` rate-limited, `500` unexpected server failure.

**401 vs. 403 — different frontend behavior, not just different numbers.** `401` means no valid session at all; the frontend clears local auth state and redirects to login. `403` means a valid, authenticated session that simply lacks permission for this specific action (e.g. staff attempting an owner-only staff-lifecycle action within their own business, Section 9); the frontend stays logged in and shows an in-context "not permitted" message. Never redirect to login on a 403.

**Cross-principal access always returns 404, never 403.** Generalized beyond just cross-tenant: any resource the caller does not legitimately have access to — wrong business, or a different customer's booking within the *same* business (e.g. a manipulated `bookingId` on a magic-link reschedule/cancel call) — returns the identical `404` a genuinely nonexistent resource would, never revealing existence through status code, message, or metadata. `403` is reserved specifically for same-tenant role/permission failures, where existence is already implied by context and there's no enumeration risk (the clean illustration: staff attempting an owner-only action in their own business is `403`; staff or a customer probing another tenant's or another customer's resource is `404`).

**Response projection: explicit allowlist per audience, never a raw document.** Every response is built from an explicit per-endpoint field allowlist — never `res.json()` on a raw Mongoose document, never a denylist/exclusion approach (which would leak any newly-added schema field by default until someone remembers to exclude it; allowlist means a new field never appears anywhere until someone deliberately adds it to a projection). Two named tiers: **customer projection** (magic-link/self-service) and **staff/owner projection** (dashboard). Fields that never appear in *any* response to *any* client, at either tier: `passwordHash`, `accessTokenHash`, `holdVersion`, session identifiers, Redis keys. `noShowRiskNote` (Section 10) appears only in the staff/owner tier. This same allowlist discipline — and the identical UTC date convention below — applies to every emitted Socket.IO event payload, not just REST responses (Section 9's Socket.IO channel-scoping note is the companion authorization half of this).

**Enumeration resistance.** Any endpoint accepting a token/identifier from an untrusted, anonymous caller (magic-link open, login, a hypothetical future anonymous resend) returns an identical response for "doesn't exist," "expired," and "revoked/invalid" — already established for magic links (Section 9a) and login (Section 9), generalized here project-wide. This does **not** apply to an authenticated owner/staff action on a resource already visible in their own dashboard (e.g. an owner resending a pending invitation they can already see) — there's no enumeration risk when the caller already knows the resource exists; such actions use the normal authorization/error contract above. No customer-facing anonymous magic-link-resend endpoint is assumed to exist by this rule — it's a standing contract for any future untrusted resend endpoint, not a feature being added now.

**Validation errors.** `{ error: { code: 'VALIDATION_ERROR', message, fields: { <fieldName>: <safeDetail> } } }` — field-level detail is safe since it only describes the caller's own submitted input.

**Rate limiting.** `429` with a `Retry-After` header (safe to expose — returned identically regardless of account existence, Section 9) and a generic body.

**Conventions:** no pagination envelope (no endpoint has an unbounded-list shape needing one — public browsing and dashboard queries are inherently bounded, aggregate/date-scoped reads); optional fields are always present with value `null`, never omitted; all dates are ISO 8601 UTC strings, consistent with the millisecond-precision UTC convention already used for `issuedAt`/`passwordChangedAt`/`sessionsInvalidatedAt` (Section 9); Mongo `ObjectId`s are exposed directly as opaque strings (renamed `id`, not `_id`) — no obfuscation layer, since an ObjectId isn't a meaningful leak for this app's threat model and building one isn't justified; a Redis failure during login is a plain `500 INTERNAL_ERROR` (fail-closed, Section 9), never infrastructure detail in the body.

### 13a. Route reference

Every application route lives under the `/api` prefix; `/health` is the sole, deliberate exception, unprefixed — a standard ops/monitoring convention, not part of the versioned application contract, checked independently at deploy time (Section 14). Route *paths and HTTP methods* are not a load-bearing architectural choice — any reasonable RESTful naming works identically, since every route ultimately calls the same domain functions already specified in full elsewhere in this document (Sections 3, 4, 9, 9a, 9b, 9c, 10) — but a concrete, complete table is fixed here so no two implementers invent different names for the same operation.

| Method & path | Actor | Auth | Calls into | Notable responses |
|---|---|---|---|---|
| `POST /api/auth/signup` | Anonymous → becomes owner | None | Business+owner transaction (§4d) | `409` duplicate email/slug (bounded auto-retry on slug collision only) |
| `POST /api/auth/login` | Owner/staff | None | Session issuance (§9) | `401` bad credentials, `429` rate-limited |
| `POST /api/auth/logout` | Owner/staff | Session | Delete Redis session (§9) | `401` if already invalid |
| `POST /api/auth/logout-everywhere` | Owner/staff | Session | Stamp `sessionsInvalidatedAt` (§9) | Triggering session dies too; frontend redirects to login |
| `POST /api/staff/invitations` | Owner | Session, owner-only | Invite/resend (§9b) | `403` non-owner, `409` existing active User |
| `POST /api/staff/invitations/:token/accept` | Invitee (holds token) | None (token) | Acceptance transaction (§9b) | `404` generic for expired/revoked/invalid (enumeration resistance) |
| `PATCH /api/staff/:userId/remove` | Owner | Session, owner-only | Removal cascade (§9b) | `403` non-owner; unreachable against the sole owner by construction (§9) |
| `PATCH /api/staff/:userId/reactivate` | Owner | Session, owner-only | Reactivation (§9b) | `403` non-owner |
| `POST /api/resources` | Owner/staff | Session | Resource creation (§2/§9c) | `400` validation |
| `PATCH /api/resources/:id/retire` | Owner/staff | Session | Retirement cascade (§9c) | `404` cross-tenant |
| `PATCH /api/resources/:id/reactivate` | Owner/staff | Session | Reactivation (§9c) | `404` cross-tenant |
| `POST /api/services` | Owner/staff | Session | Service creation (§2) | `400` validation |
| `PATCH /api/services/:id/deactivate` | Owner/staff | Session | Deactivation cascade (§2c) | `404` cross-tenant |
| `PATCH /api/services/:id/reactivate` | Owner/staff | Session | Reactivation (§2c) | `404` cross-tenant |
| `POST /api/provider-availability` | Owner/staff | Session | Centralized provider-validation function (§2b) | `400`/`404` invalid provider or inactive service |
| `GET /api/businesses/:slug/availability` | Public/customer | None | Aggregate slot-bucket query, `datetime >= now` (§4b) | `404` unknown slug |
| `POST /api/bookings/hold` | Public/customer | None (`sessionId` in body) | Atomic conditional write, `available → held` (§4) | `409 SLOT_NO_LONGER_AVAILABLE` |
| `POST /api/bookings/confirm` | Public/customer | None (`sessionId`+`holdVersion`) | Hold-confirmation write, `holdVersion`-gated (§4) | `409 HOLD_EXPIRED` |
| `POST /api/bookings/walk-in` | Staff/owner | Session | `available → confirmed` direct write, sets `createdBy` (§3) | `409 SLOT_NO_LONGER_AVAILABLE` |
| `POST /api/magic-link/exchange` | Customer (holds raw token) | None (token) | Verify against `accessTokenHash`, issue cookie (§9a) | `404` generic for invalid/expired |
| `POST /api/magic-link/resend` | Customer (anonymous) | None | Resend, soonest-booking default (§9a) | Always the identical neutral response (enumeration resistance) |
| `POST /api/bookings/:id/cancel` | Customer (cookie) or staff/owner | Magic-link cookie or session | Shared `cancelBooking()` (§3) | `409` already terminal, `403` past cutoff (customer only) |
| `POST /api/bookings/:id/reschedule` | Customer (cookie) or staff/owner | Magic-link cookie or session | Reschedule transaction (§4) | `409` new slot unavailable, `403` past cutoff |
| `PATCH /api/bookings/:id/complete` | Staff/owner only | Session | Manual status set (§3) | `409` already terminal |
| `PATCH /api/bookings/:id/no-show` | Staff/owner only | Session | Manual status set (§3) | `409` already terminal |
| `PATCH /api/slots/:id/block` | Staff/owner | Session | Manual short-term closure (§3) | `409` slot not currently `available` |
| `POST /api/waitlist` | Public/customer | None | Waitlist join (§6) | `400` validation |
| `GET /health` | Ops/monitoring | None | `isDatabaseConnected()` check | `200 ok` / `503 degraded` — its own shape, deliberately outside the `{data}`/`{error}` contract above |
| Socket.IO `slot:updated` | Server → business room | Session/handshake, server-resolved room (§9) | Emitted post-commit from any Slot-mutating path (§7) | Not a REST route — push-only, best-effort |

---

## 14. Deployment topology

**Single combined deployment: one origin serves both the API and the built frontend.** The Express app serves API routes and the built frontend static assets from the same server/port — one deployed service, true same-origin (stronger than merely same-site). This satisfies Section 9's session-cookie requirements with zero CORS configuration, no `SameSite=None`, and **no CSRF middleware for MVP**, since the authenticated application never makes a cross-origin request to itself. It also needs no purchased/configured custom domain — the default host the platform assigns is sufficient, since frontend and backend were never on different hosts to begin with.

**Routing split.** All application routes are mounted under `/api` (Section 13a's route table); everything else on the same origin is the built frontend's static assets, served for any non-`/api` path so client-side routing works on a hard refresh. `/health` is the one deliberate exception — unprefixed, since it's an ops/monitoring convention checked independently of API versioning, not part of the `{data}`/`{error}` application contract. Locally, the frontend runs on its own dev server for fast reload; a dev-time proxy forwards `/api/*` requests to the backend so the exact same relative-path calls work unchanged in both environments, with no frontend-side API base-URL configuration needed in either.

A genuinely cross-site default-subdomain deployment (e.g. a frontend on one free-tier host and a backend on another, different registrable domain) is explicitly rejected for MVP: it would force `SameSite=None` and make CSRF protection mandatory — real, avoidable complexity this project's scale doesn't need.

The BullMQ worker (Section 6) runs as a separate process or sibling service if the hosting platform requires it for a long-running job runner, pointed at the same Redis instance as the API — this is a process-topology detail, not a code-architecture one. Frontend and backend remain separate applications in the monorepo (Section 1) regardless of deployment shape; serving them from one origin is a deployment-config decision, not a code merge, and nothing here prevents moving to a split, CDN-backed frontend deployment later if a custom domain becomes available — that would change hosting config, not application code.
