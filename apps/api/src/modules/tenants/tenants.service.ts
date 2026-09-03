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

  return {
  id: String(business._id),
  name: business.name,
  slug: business.slug,
  ownerId: business.ownerId,
  timezone: business.timezone,
  cancellationCutoffMinutes: business.cancellationCutoffMinutes,
};
}
