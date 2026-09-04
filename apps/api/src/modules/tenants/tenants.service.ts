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
 * Signup is business creation: the `Business` and the owner `User` are
 * written in one transaction, both or neither. This function only does the
 * `Business` insert, enrolled in the caller's `session`.
 *
 * Slug collisions are the caller's problem: a concurrent collision surfaces
 * here as a duplicate-key error on the `Businesses.slug` unique index, and
 * the caller retries with a fresh slug.
 */
export async function createBusiness(
  input: CreateBusinessInput,
  session: ClientSession,
): Promise<Business> {
  // The Business and the owner User are both-or-neither; fail loudly rather
  // than half-write if there's no open transaction.
  if (!session.inTransaction()) {
    throw new Error(
      "createBusiness must run inside a transaction: the Business and owner User are " +
        "written both-or-neither",
    );
  }

  // Array form so the insert is enrolled in `session` — Model.create only
  // honours the session option when given an array of docs.
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
 * In practice always "get my own business" — every session carries
 * exactly one `businessId`.
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
 * Returns one business by its public slug — how an anonymous caller
 * (the public booking page) looks a business up, since it never has
 * a businessId to work with.
 */
export async function getBusinessBySlug(
  slug: string,
): Promise<Business | null> {
  const business = await BusinessModel.findOne({ slug });

  if (!business) {
    return null;
  }

  return toBusiness(business);
}

/**
 * Input required to update a business.
 *
 * `slug` and `ownerId` are not editable here — there is no supported flow
 * to change either.
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
 * Returns null if no business exists with the given id.
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
