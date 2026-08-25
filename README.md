# QueueLess++

Multi-tenant appointment and queue management platform. The core engineering
problem QueueLess++ solves is guaranteeing that two customers can never book
the same slot under concurrent load — and extending that same correctness
guarantee to rescheduling.

See [`queueless-plus-plus-architecture.md`](./queueless-plus-plus-architecture.md)
for the full design document (schema, state machine, transaction strategy,
Redis usage, queue/real-time architecture, and phase plan). This README
covers what's actually in the repo today and how to run it.

## Core Engineering Focus

Per the architecture document, the project is built around:

- **Multi-tenancy** — every business-scoped collection carries `businessId`,
  enforced in middleware rather than per-route.
- **Concurrent booking protection** — an atomic conditional write
  (`findOneAndUpdate` with a status guard) prevents double-booking, with no
  read-then-write race window.
- **Atomic booking operations** — rescheduling spans two documents (release
  old slot, claim new slot) inside a single MongoDB transaction, so both
  changes succeed or neither does.
- **Modular monolith architecture** — one deployable Express app, organized
  into feature modules (`auth`, `tenants`, `bookings`, and more to come) that
  only communicate through exported service functions, never by reaching
  into another module's models.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite, Tailwind CSS, shadcn/ui (configured, components not yet generated) |
| Backend | Node.js + Express + TypeScript |
| Database | MongoDB Atlas (via Mongoose) |
| Cache / holds | Redis (Upstash), via ioredis |
| Logging | Pino (`pino`, `pino-http`) |
| Validation | Zod |
| Shared types | Internal `@queueless/shared-types` package |
| Monorepo tooling | npm workspaces + Turborepo |

Real-time updates (Socket.IO), background jobs (BullMQ), and AI no-show
scoring (Gemini) are part of the planned architecture but are **not yet
present in the codebase** — see [Current Project Status](#current-project-status).

## Repository Structure

```
.
├── apps/
│   ├── api/                  # Express + TypeScript backend
│   │   └── src/
│   │       ├── modules/      # auth, tenants, bookings (route/controller/service per module)
│   │       ├── middleware/   # errorHandler, validate (Zod)
│   │       ├── lib/          # env, db (Mongoose), redis (ioredis), logger (Pino)
│   │       └── server.ts
│   └── web/                  # React + TypeScript frontend (Vite)
│       └── src/
├── packages/
│   └── shared-types/         # TypeScript types shared between apps/api and apps/web
└── queueless-plus-plus-architecture.md
```

## Prerequisites

- Node.js and npm compatible with `packageManager: npm@11.17.0` (set in the
  root `package.json`)
- A MongoDB Atlas cluster (connection string)
- An Upstash Redis instance (TCP connection URL, not the REST URL)

## Environment Setup

**Never commit a real `.env` file.** `.env` is gitignored; 
`.env.example`
documents every variable and is the file to copy from.

```bash
cp .env.example apps/api/.env
# then fill in the real values
```

### Currently required (the backend will not start without these)

| Variable | Used for |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `REDIS_URL` | Upstash Redis TCP connection URL |

These are validated at startup with Zod (`apps/api/src/lib/env.ts`) — the
process exits immediately if either is missing.

### Present in `.env.example` but not yet used by any code

| Variable | Planned for |
|---|---|
| `PORT` | Optional override; defaults to `4000` if unset (not currently required) |
| `NODE_ENV` | Not currently read by any code |
| `JWT_SECRET` | Auth module (JWT is not implemented yet — `auth` is a status-only skeleton) |
| `GEMINI_API_KEY` | Planned AI no-show scoring (Phase 3, not implemented) |
| `EMAIL_API_KEY` | Planned notification system (Phase 3, not implemented) |
| `VITE_API_URL` | Planned frontend API client (not implemented — the frontend does not yet call the backend) |

## Installation

From the repository root:

```bash
npm install
```

This installs and links all workspaces (`apps/*`, `packages/*`) in one step.

## Running Locally

Run everything in parallel via Turborepo from the root:

```bash
npm run dev
```

Or run a single workspace:

```bash
npm run dev --workspace=@queueless/api   # backend on http://localhost:4000
npm run dev --workspace=web              # frontend on Vite's dev server
```

## Verification

With `apps/api/.env` filled in, start the API and check the logs and
`/health` endpoint:

```bash
npm run dev --workspace=@queueless/api
```

- **Backend starts** — you should see `API listening on http://localhost:<port>` in the logs.
- **MongoDB connects** — a `"MongoDB connected"` log line appears before the
  server starts listening; the process exits with an error if it can't connect.
- **Redis connects** — `checkRedisConnection()` pings Redis at startup as
  part of the same boot sequence; a connection error is logged via
  `redis.on('error', ...)` if it fails.
- **`/health` responds:**

  ```bash
  curl http://localhost:4000/health
  # {"status":"ok","database":"connected"}
  ```

  Returns HTTP 503 with `"status":"degraded","database":"disconnected"` if
  MongoDB is not connected. (Redis state is not currently reported by
  `/health` — only checked at startup.)

## Build

```bash
npm run build
```

Runs `turbo run build` across all workspaces (`tsc` for `@queueless/api` and
`@queueless/shared-types`, `tsc -b && vite build` for `web`).

## Architecture

QueueLess++ is a **modular monolith**: a single deployable Express app
internally organized into feature modules (`auth`, `tenants`, `bookings`,
with `staff`, `services`, `availability`, `waitlist`, `notifications`, and
`realtime` planned) that communicate only through exported service
functions, never by reaching into another module's models directly. This
keeps each module a natural service boundary without the operational cost
of microservices at this scale.

For the full schema, booking state machine, transaction strategy, Redis
usage breakdown, queue design, and real-time architecture, see
[`queueless-plus-plus-architecture.md`](./queueless-plus-plus-architecture.md).

## Development Phases

| Phase | Focus |
|---|---|
| **Phase 1 — Foundations** | Multi-tenant schema, auth/RBAC, business/service/staff CRUD, deploy pipeline live from day 1 |
| **Phase 2 — Core booking engine** | Atomic booking, Redis holds, real-time slot updates, waitlist auto-fill |
| **Phase 3 — Reschedule, cancellation, notifications** | Transaction-based reschedule, cancellation flow, BullMQ reminder jobs, AI no-show scoring |
| **Phase 4 — Polish & demo prep** | Concurrency/reschedule demo rehearsal, deploy hardening, README/architecture diagram |
| **Phase 5 — Stretch (optional)** | Basic analytics |

See the architecture document for full phase detail.

## Current Project Status

**Implemented:**

- Monorepo scaffolding (npm workspaces + Turborepo) with `apps/api`,
  `apps/web`, `packages/shared-types`
- Express + TypeScript backend that starts, connects to MongoDB Atlas
  (Mongoose) and Redis (ioredis), and exposes a real `/health` check
- Environment variable loading and validation (`dotenv` + Zod)
- Structured logging (Pino, including HTTP request logging via `pino-http`)
- Global error-handling middleware and a reusable Zod request-validation
  middleware
- Modular route skeletons for `auth`, `tenants`, and `bookings`, each
  currently exposing only a `/status` endpoint (no business logic yet)
- React + TypeScript + Vite frontend with Tailwind configured and a basic
  routed app shell (dashboard/admin/booking placeholder pages)
- `packages/shared-types` building and consumed by both apps

**Not yet implemented (planned per the phases above):**

- Any real domain logic in `auth`, `tenants`, or `bookings` (schemas,
  services, business rules)
- `staff`, `services`, `availability`, `waitlist`, `notifications`, and
  `realtime` modules
- The booking state machine, atomic booking writes, and transaction-based
  reschedule
- Socket.IO real-time updates and BullMQ background jobs
- AI no-show scoring (Gemini)
- Frontend API client and any frontend-to-backend communication
- shadcn/ui components (configured via `components.json`, none generated yet)
- CI/CD and deployment
