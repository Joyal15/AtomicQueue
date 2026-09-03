import type { ClientSession } from "mongoose";

import type { Business } from "@queueless/shared-types";

import { BusinessModel } from "./tenants.model.js";

export interface CreateBusinessInput {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  timezone: string;
  cancellationCutoffMinutes: number;
}

/**
 * Converts a MongoDB business document into the shared API type.
 */
function toBusiness(business: {
  _id: unknown;
  name: string;
  slug: string;
  ownerId: string;
  timezone: string;
  cancellationCutoffMinutes: number;
}): Business {
  return {
    id: String(business._id),
    name: business.name,
    slug: business.slug,
    ownerId: business.ownerId,
    timezone: business.timezone,
    cancellationCutoffMinutes: business.cancellationCutoffMinutes,
  };
}

/**
 * Insert the `Business` half of owner signup.
 *
 * Signup *is* business creation (architecture doc Section 4d): it is the only path that
 * produces an owner account, and the `Business` plus the owner `User` must be written in
 * one transaction — both or neither. The auth module owns that transaction, the
 * pre-generated ObjectIds, slug generation, the owner `User` insert, and every
 * post-commit side effect (session issuance, welcome email). This function's whole job is
 * the single `Business` insert, enrolled in the caller's `session` so it commits and
 * rolls back with the rest.
 *
 * Collision handling belongs to the caller. The `Businesses.slug` unique index is the
 * real guard, not any pre-check (Section 4d): a concurrent slug collision surfaces here
 * as a duplicate-key error (`MongoServerError`, code `11000`), and the caller catches that
 * specific failure and retries the whole transaction with a fresh candidate slug (bounded
 * retry count). A duplicate-*email* failure from the sibling `User` insert must not be
 * retried that way — it is a real "email already registered" error.
 */
export async function createBusiness(
  input: CreateBusinessInput,
  session: ClientSession,
): Promise<Business> {
  // Section 4d: the Business and the owner User are both-or-neither. Without an open
  // transaction that guarantee is silently gone, so fail loudly rather than half-write.
  if (!session.inTransaction()) {
    throw new Error(
      "createBusiness must run inside a transaction: the Business and owner User are " +
        "written both-or-neither (architecture doc Section 4d)",
    );
  }

  // Array form so the insert is enrolled in `session` — Model.create only honours the
  // session option when given an array of docs.
  const [business] = await BusinessModel.create(
    [
      {
        _id: input.id,
        name: input.name,
        slug: input.slug,
        ownerId: input.ownerId,
        timezone: input.timezone,
        cancellationCutoffMinutes: input.cancellationCutoffMinutes,
      },
    ],
    { session },
  );

  return toBusiness(business);
}

/**
 * Returns one business by id.
 *
 * Every authenticated user's session carries exactly one `businessId`
 * (owner or staff), so this is always "get my own business" in practice —
 * there is no cross-tenant lookup path here.
 */
export async function getBusinessById(
  businessId: string,
): Promise<Business | null> {
  const business = await BusinessModel.findById(businessId);

  if (!business) {
    return null;
  }

  return toBusiness(business);
}

/**
 * Input required to update a business.
 *
 * Deliberately narrow: `slug` and `ownerId` are not editable here.
 * `slug` has no defined change flow in the architecture doc, and
 * `ownerId`/ownership transfer is explicitly out of scope for MVP
 * (architecture doc Section 4d) — there is no path that should ever
 * repoint a Business at a different owner.
 */
export interface UpdateBusinessInput {
  businessId: string;
  name?: string;
  timezone?: string;
  cancellationCutoffMinutes?: number;
}

/**
 * Updates a business's editable settings.
 *
 * Returns null if no business exists with the given id — in practice
 * this only happens if `businessId` itself is malformed/stale, since a
 * caller's own session always carries a real one.
 */
export async function updateBusiness(
  input: UpdateBusinessInput,
): Promise<Business | null> {
  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updates.name = input.name;
  }

  if (input.timezone !== undefined) {
    updates.timezone = input.timezone;
  }

  if (input.cancellationCutoffMinutes !== undefined) {
    updates.cancellationCutoffMinutes = input.cancellationCutoffMinutes;
  }

  const business = await BusinessModel.findByIdAndUpdate(
    input.businessId,
    updates,
    { new: true },
  );

  if (!business) {
    return null;
  }

  return toBusiness(business);
}
