# QueueLess++ — Architecture & Design Document

Multi-tenant appointment and queue management platform. This is a scoped-down version of the original QueueLess++ brief — the good structural additions are kept, the scope-creep risks are cut or demoted to optional stretch work. See "What we removed and why" at the bottom of this section before reading further.

**Stack:** React + TypeScript + Tailwind + shadcn/ui (frontend) · Node.js + Express + TypeScript (backend) · MongoDB Atlas (database, with transactions) · Redis / Upstash (holds, caching) · Socket.IO (real-time) · BullMQ (background jobs) · Gemini 1.5 Flash free tier (AI no-show scoring)

**Team:** 2 people · **Timeline: 3.5–4 weeks** (up from the original QueueLess's 2.5–3 weeks — this is a deliberate, justified increase, not scope creep)

**Architectural style:** Modular monolith. One deployable Express app, internally organized into clear feature modules (bookings, notifications, availability, tenants) that don't reach into each other's internals. No microservices — unnecessary at this scale and indefensible in an interview ("why microservices for a project with a handful of concurrent demo users" is a question you don't want to answer).

---

## What we removed and why

| Removed / demoted | Why |
|---|---|
| **Analytics dashboards** | Demoted to explicit stretch/Phase 4. A real analytics feature is its own mini-project (time-bucketed rollups, pre-aggregation vs. compute-on-read) with its own scalability story — building it shallow ("a few COUNT queries with a chart") undermines the rest of the project if an interviewer pushes on it. Better to not have it than to have a weak version of it. |
| **"Production-quality" framing** | Removed as a stated goal. This phrase quietly justifies open-ended scope (comprehensive logging, monitoring, exhaustive validation everywhere) that produces zero new interview talking points relative to time spent. We're building "one genuinely well-engineered product," not "a production SaaS company" — the standard you set for yourself originally. |
| **Comprehensive notification system (SMS + push + email + in-app)** | Scoped down to email-only for MVP, same reasoning as the original QueueLess (Twilio trial limitations, and multi-channel delivery is really the NotifyHub idea, a different project). |

## What we kept, and why it's worth the extra time

| Kept | Why it's a good addition |
|---|---|
| **Explicit booking state machine** | Formalizes states you already had implicitly — a design exercise, not new build time. Strong interview asset. |
| **Rescheduling as one atomic operation** | Genuinely harder and better than the original plain-booking concurrency story — a two-document atomic transaction (release old slot + claim new slot, both or neither) is a real upgrade. |
| **Cancellation** | Small addition, completes the state machine, needed for the waitlist auto-fill to make sense anyway. |
| **Modular monolith structuring** | Near-zero extra cost (it's how you should organize the code regardless), and gives you a strong, honest answer to "why not microservices." |
| **RBAC formalized (owner/staff/customer)** | Already implicit in original QueueLess; naming it explicitly is just being precise about what you're building. |

---

## 1. Repository structure (modular monolith)

```
queueless/
├── apps/
│   ├── api/                     # Express backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── tenants/     # Business/org creation, slug routing
│   │   │   │   ├── auth/        # JWT auth, RBAC middleware
│   │   │   │   ├── staff/       # Staff/provider management
│   │   │   │   ├── services/    # Service catalog per business
│   │   │   │   ├── availability/# Slot generation from staff schedules
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

Users
  - _id, name, email, passwordHash, role (owner | staff | customer)
  - businessId (ref, null for customers)

Services
  - _id, businessId (ref), name, durationMinutes, price

StaffAvailability
  - _id, businessId (ref), staffId (ref → Users), 
    dayOfWeek, startTime, endTime   # recurring weekly template

Slots
  - _id, businessId (ref, denormalized), staffId (ref), serviceId (ref)
  - datetime, status: 'available' | 'held' | 'confirmed' | 'completed' | 'cancelled'
  - version (int, for optimistic checks on non-booking updates like staff editing slot details)

Bookings
  - _id, businessId (ref, denormalized), slotId (ref)
  - customer: { name, contact }        # no account, per original design
  - status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
  - createdAt, cancelledAt

WaitlistEntries
  - _id, businessId (ref), customer: { name, contact }
  - desiredServiceId, desiredStaffId (optional), 
  - status: 'waiting' | 'notified' | 'expired' | 'converted'
  - createdAt
```

**Design decisions worth explaining in an interview:**
- `businessId` denormalized onto `Slots` and `Bookings` directly (not just inherited via joins) — every query filters by tenant, a join chain to get there would be wasteful.
- `Slots` and `Bookings` are separate collections rather than one merged collection — a slot's *existence* (staff availability) is independent of whether it's ever booked; keeping them separate makes "generate next week's slots from staff availability" a clean, independent job that doesn't need to know anything about booking state.

---

## 3. Booking state machine

```
                    ┌─────────────┐
                    │  available  │◄───────────────┐
                    └──────┬──────┘                │
                            │ customer initiates booking
                            ▼                        │
                    ┌─────────────┐        waitlist  │
                    │    held     │        auto-fill │
                    │ (Redis TTL) │        on cancel │
                    └──────┬──────┘                  │
              timeout│      │ confirmed              │
              or fail│      ▼                        │
                    │┌─────────────┐                 │
                    └►  confirmed  │                 │
                    └──────┬──────┘                  │
                            │                          │
                ┌───────────┼───────────┐              │
                ▼           ▼           ▼              │
        ┌───────────┐┌───────────┐┌───────────┐        │
        │ completed ││ cancelled │├──────────►┘────────┘
        │           ││(releases  ││ reschedule
        └───────────┘│ slot back ││(atomic: cancel old +
                      │to available)│ confirm new, or neither)
                      └───────────┘
```

**Rules enforced by the state machine, not left implicit:**
- `available → held` only via the atomic reservation operation (Section 4)
- `held → confirmed` on successful payment/confirmation step, or immediately if no confirmation step is used
- `held → available` automatically on Redis TTL expiry (customer abandoned checkout)
- `confirmed → cancelled` releases the slot and triggers waitlist auto-fill
- `confirmed → completed` is staff-marked, terminal
- Reschedule is modeled as **one transaction** touching two Slot documents (old → cancelled, new → confirmed), never as two separate API calls a client could interrupt halfway through

---

## 4. Concurrency & transaction strategy

### The core problem
Two customers attempt to book the same slot within milliseconds. Exactly one must succeed; the other must fail cleanly and be offered the waitlist.

### The solution: atomic conditional write, not read-then-write
```js
// Booking — single atomic operation, no race window
const slot = await Slot.findOneAndUpdate(
  { _id: slotId, status: 'available' },
  { $set: { status: 'held', heldBy: sessionId, heldAt: new Date() } },
  { new: true }
);

if (!slot) {
  // Someone else claimed it first — offer waitlist immediately
  return { success: false, offerWaitlist: true };
}
```

### Reschedule — the harder case, needs a real transaction
Rescheduling touches **two documents** (release old slot, claim new slot) and both must succeed or neither does — this is what an atomic single-document update can't give you, and it's why a proper Mongo session/transaction is used here specifically (not for plain booking, where the single-document conditional update is sufficient and faster):

```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    const oldSlot = await Slot.findOneAndUpdate(
      { _id: oldSlotId, status: 'confirmed' },
      { $set: { status: 'available' } },
      { session, new: true }
    );
    if (!oldSlot) throw new Error('Original booking no longer valid');

    const newSlot = await Slot.findOneAndUpdate(
      { _id: newSlotId, status: 'available' },
      { $set: { status: 'confirmed' } },
      { session, new: true }
    );
    if (!newSlot) throw new Error('Requested new slot no longer available');

    await Booking.findOneAndUpdate(
      { slotId: oldSlotId },
      { $set: { slotId: newSlotId } },
      { session }
    );
  });
} finally {
  session.endSession();
}
```

**Interview-ready explanation of why these two use different mechanisms:** plain booking is a single-document state transition, so an atomic conditional update is simpler and faster than a full transaction. Reschedule inherently spans two documents that must change together or not at all — that's exactly the case a transaction exists for. Using a transaction for both would be unnecessary overhead on the hot path (booking); using a conditional update for reschedule would risk one slot changing without the other.

---

## 5. Redis usage — what lives where, and why

| Data | Lives in | Why |
|---|---|---|
| Slot's durable status (`available`/`confirmed`/etc.) | MongoDB | Source of truth, must survive restarts, queried in complex ways |
| "Currently being booked" hold with auto-expiry | Redis (`SET hold:slotId sessionId EX 300 NX`) | Ephemeral, needs automatic TTL expiry — exactly what Redis is for, awkward to replicate in Mongo without a cron job |
| Dashboard aggregate counts (today's bookings, upcoming count) | Redis cache, invalidated on write | Read-heavy, cheap to cache, doesn't need to be live-exact to the millisecond |
| Rate limit counters (public booking endpoint) | Redis | Needs atomic increment + expiry, standard use case |

**Note:** the *actual* atomicity guarantee for booking comes from Mongo's `findOneAndUpdate` (Section 4), not from Redis. Redis's hold is a **UX nicety** (shows "someone else is looking at this slot" / reserves it briefly during checkout), not the correctness mechanism — worth being precise about this distinction in an interview, since conflating "Redis lock" with "the thing that actually prevents double-booking" is a common and telling mistake.

---

## 6. Queue architecture (BullMQ)

```
Jobs:
  - send-reminder-email      (scheduled, fires 24h and 1h before appointment)
  - process-hold-expiry      (repeatable, sweeps expired Redis holds back to 'available' 
                               — belt-and-suspenders alongside Redis TTL itself)
  - waitlist-notify          (triggered on cancellation, notifies next waitlist entry, 
                               gives them a short window to claim before moving to the next)
  - generate-weekly-slots    (scheduled, generates next week's Slot documents 
                               from each staff member's StaffAvailability template)
```

Why queued rather than done inline: reminder emails and slot generation are not something a customer's booking request should wait on — they're enqueued and processed by a worker independently, keeping the booking API's response time fast and predictable regardless of email provider latency.

---

## 7. Real-time architecture (Socket.IO)

- Customers viewing a business's public booking page join a room scoped to that business (`business:${businessId}`)
- On any slot status change (held/confirmed/cancelled), the server emits to that room only — **tenant-scoped rooms**, so Business A's customers never receive Business B's events (a real, checkable multi-tenancy correctness point)
- Staff dashboard joins the same room, sees live bookings come in

```js
io.to(`business:${businessId}`).emit('slot:updated', { slotId, status });
```

---

## 8. Notification system (MVP scope: email only)

```
Trigger → enqueue BullMQ job → worker sends via email provider → log delivery status
```

- Booking confirmation (immediate)
- Reminder (24h and 1h before, scheduled jobs)
- Cancellation confirmation
- Waitlist "a slot opened up" notification (time-boxed — if not claimed within N minutes, moves to the next person in line)

SMS/push explicitly out of scope — noted as a "would add NotifyHub-style multi-channel delivery here in a real product" talking point, not built.

---

## 9. Multi-tenancy & RBAC

- Every business-scoped collection carries `businessId`; every query is filtered by it — enforced in middleware, not repeated manually per-route, to reduce the chance of a forgotten filter
- Roles: `owner` (manages business, staff, services), `staff` (manages their own availability, views/manages bookings for their business), `customer` (no account, contact-only)
- **Server-side enforcement only** — a hidden button in the UI is not access control; every mutating route re-checks role + businessId match against the authenticated user, never trusts client-side state

---

## 10. AI feature (kept from original QueueLess, unchanged)

No-show risk scoring — Gemini 1.5 Flash free tier, reads aggregated customer booking history (past no-show count, lead time patterns), returns a plain-language risk note shown to staff. Falls back silently to "no risk data" if the API is unavailable. Rate-limited to one computation per booking creation, not recomputed on every page view.

---

## 11. Development phases

| Phase | Weeks | Focus |
|---|---|---|
| **Phase 1 — Foundations** | Week 1 | Multi-tenant schema, auth/RBAC, business/service/staff CRUD, deploy pipeline live from day 1 |
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
3. **The second demo, if they seem engaged:** reschedule an appointment, and explain that under the hood this is a transaction touching two documents — contrast it with the booking demo to show you understand *why* the mechanism differs (single atomic update vs. multi-document transaction), not just that you used "transactions" as a buzzword.

**When they ask "why MongoDB, why not SQL":** be honest and specific — "I could have used Postgres and gotten transactions natively either way; I chose Mongo because the tenant-scoped, denormalized document shape mapped naturally to how I query by business, and I wanted to demonstrate I understand when a transaction is actually necessary (multi-document operations) versus when an atomic single-document update is sufficient and faster (the hot-path booking case) — using a transaction for everything would have been the less precise answer."

**If they push on scale ("what breaks at 100x traffic"):** give the honest, specific answer — the booking write path scales fine (it's O(1) per request, Mongo indexes the slot lookup), but the dashboard aggregate queries and the public booking page reads would need the Redis caching layer to take real pressure off Mongo, and Socket.IO would need to move off in-memory adapter to the Redis adapter for horizontal scaling across multiple server instances. Say what you *would* add, and why you didn't build it for a project with a handful of demo users — that distinction (knowing the next step vs. having built it) is itself a strong signal.

**If they ask "why not microservices":** this is the modular monolith payoff — "each feature module (bookings, notifications, availability) only talks to other modules through their exported functions, never by reaching into another module's database models directly. That means if a specific module ever needed to scale or deploy independently, the boundary's already there — I didn't reach for microservices on a project with a handful of concurrent users, because that complexity needs to be justified by an actual scaling need, not assumed upfront."

**What to explicitly say you scoped out, if asked:** analytics dashboards ("I deliberately kept this to a stretch goal — a real analytics feature needs its own design around pre-aggregation, and I didn't want to ship something shallow just to check a box") and multi-channel notifications ("email-only for this project; SMS/push would be the same architecture with an additional delivery channel in the notification worker, not a redesign"). Naming what you *cut and why* reads as more senior than pretending the project has no edges.
