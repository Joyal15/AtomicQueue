/**
 * Service layer for the Providers module.
 *
 * "Provider" is a domain concept, not a collection — there is no
 * Providers table. A staff provider is a `Users` row (`auth`
 * module); a resource provider is a `Resources` row. `providerId` +
 * `providerType` is a polymorphic reference, and MongoDB cannot
 * enforce it as a foreign key, so this module owns the ONE function
 * that resolves and checks it safely.
 *
 * `validateProvider` is centralized here and called by every write
 * path that sets or changes a `providerId`/`providerType` pair
 * (`ProviderAvailability` creation, slot generation, any admin
 * edit) — never re-implemented per route (architecture doc
 * Section 2b).
 */

import { Types } from 'mongoose';

import type { ProviderType } from '@queueless/shared-types';

import { getResources } from '../resources/index.js';
import { ResourceModel } from '../resources/resources.model.js';
import { UserModel } from '../auth/auth.model.js';

import type { Provider } from './providers.model.js';

/**
 * Roles allowed to act as a bookable staff provider.
 *
 * Kept as its own named predicate rather than an inline
 * `role === 'staff' || role === 'owner'` check, on purpose:
 * "eligible to act as a provider" and "has RBAC role X" are allowed
 * to diverge later (e.g. a future staff-like role that isn't yet
 * bookable) without hunting down every comparison (architecture doc
 * Section 2b).
 *
 * Today an owner IS eligible — an owner can act as a provider
 * without a separate staff account (architecture doc Section 2 /
 * Section 2a, point 8).
 */
const PROVIDER_ELIGIBLE_ROLES = ['staff', 'owner'] as const;

export type ProviderEligibleRole =
  (typeof PROVIDER_ELIGIBLE_ROLES)[number];

export function isProviderEligibleRole(
  role: string,
): role is ProviderEligibleRole {
  return (PROVIDER_ELIGIBLE_ROLES as readonly string[]).includes(role);
}

/**
 * The resolved, verified provider reference handed back on success.
 * Deliberately minimal — callers persist `providerId` /
 * `providerType`, they don't need the full underlying document.
 */
export interface ValidatedProvider {
  businessId: string;
  providerId: string;
  providerType: ProviderType;
}

export interface ProviderValidationSuccess {
  ok: true;
  provider: ValidatedProvider;
}

export interface ProviderValidationFailure {
  ok: false;
  error:
    /** No such row, or it belongs to another business. */
    | 'PROVIDER_NOT_FOUND'
    /** Row exists in this business but status !== 'active'. */
    | 'PROVIDER_REMOVED'
    /** Staff row whose role is not allowed to be a provider. */
    | 'PROVIDER_INELIGIBLE';
}

export type ProviderValidationResult =
  | ProviderValidationSuccess
  | ProviderValidationFailure;

/**
 * Verifies, in order (architecture doc Section 2b):
 *   1. a document with that `_id` exists in the collection implied
 *      by `providerType`,
 *   2. it belongs to the caller's `businessId`,
 *   3. it is currently active (`status === 'active'`),
 *   4. for `providerType: 'staff'`, the `Users` row's role is
 *      eligible to act as a provider.
 *
 * A cross-tenant lookup fails as `PROVIDER_NOT_FOUND` — never a
 * distinct "wrong business" code — so a caller cannot tell "exists
 * elsewhere" apart from "does not exist" (architecture doc
 * Section 13).
 */
export async function validateProvider(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
): Promise<ProviderValidationResult> {
  // A malformed id string would make `findOne` throw a CastError;
  // treat it as simply not found.
  if (!Types.ObjectId.isValid(providerId)) {
    return { ok: false, error: 'PROVIDER_NOT_FOUND' };
  }

  if (providerType === 'resource') {
    const resource = await ResourceModel.findOne({
      _id: providerId,
      businessId,
    })
      .select({ _id: 1, businessId: 1, status: 1 })
      .lean();

    if (!resource) {
      return { ok: false, error: 'PROVIDER_NOT_FOUND' };
    }

    if (resource.status !== 'active') {
      return { ok: false, error: 'PROVIDER_REMOVED' };
    }

    return {
      ok: true,
      provider: {
        businessId: resource.businessId,
        providerId: String(resource._id),
        providerType: 'resource',
      },
    };
  }

  if (providerType === 'staff') {
    const user = await UserModel.findOne({
      _id: providerId,
      businessId,
    })
      .select({ _id: 1, businessId: 1, role: 1, status: 1 })
      .lean();

    if (!user) {
      return { ok: false, error: 'PROVIDER_NOT_FOUND' };
    }

    // Role first, then status: an account that could never be a
    // provider (a future front-desk-only role) reads as INELIGIBLE
    // rather than REMOVED when it also happens to be inactive.
    if (!isProviderEligibleRole(user.role)) {
      return { ok: false, error: 'PROVIDER_INELIGIBLE' };
    }

    if (user.status !== 'active') {
      return { ok: false, error: 'PROVIDER_REMOVED' };
    }

    return {
      ok: true,
      provider: {
        businessId: user.businessId,
        providerId: String(user._id),
        providerType: 'staff',
      },
    };
  }

  // Unreachable given the ProviderType union, but guards against a
  // bad cast at a call site.
  return { ok: false, error: 'PROVIDER_NOT_FOUND' };
}

export interface ListProvidersOptions {
  /** Restrict to one kind. Omitted → both staff and resources. */
  providerType?: ProviderType;
  /**
   * Also return removed providers. Default false: a picker only
   * wants currently-bookable providers, while a management view can
   * ask for the full set.
   */
  includeRemoved?: boolean;
}

/**
 * Lists a business's providers — staff and resources alike —
 * projected into the unified `Provider` shape (`providers.model`).
 *
 * This is the module's read counterpart to `validateProvider`: the
 * dashboard and the availability provider picker need one list of
 * "who/what can be booked" without caring which collection each
 * row came from (architecture doc Section 1's "unified who/what
 * gets booked").
 *
 *   - Staff: `Users` rows whose role is provider-eligible (owner or
 *     staff — Section 2b). A future front-desk-only role would be
 *     filtered out here by `isProviderEligibleRole`, same predicate
 *     `validateProvider` uses, so the two never drift.
 *   - Resources: fetched through the `resources` module's own
 *     exported `getResources`, not a direct model read, to keep the
 *     module boundary intact (Section 1). The staff side still
 *     reads `UserModel` directly only because `auth` exposes no
 *     service function yet — swap it for one when that lands.
 */
export async function listProviders(
  businessId: string,
  options: ListProvidersOptions = {},
): Promise<Provider[]> {
  const { providerType, includeRemoved = false } = options;
  const providers: Provider[] = [];

  if (providerType === undefined || providerType === 'staff') {
    const users = await UserModel.find({ businessId })
      .select({ _id: 1, businessId: 1, name: 1, role: 1, status: 1 })
      .lean();

    for (const user of users) {
      if (!isProviderEligibleRole(user.role)) {
        continue;
      }

      if (!includeRemoved && user.status !== 'active') {
        continue;
      }

      providers.push({
        providerId: String(user._id),
        providerType: 'staff',
        businessId: user.businessId,
        name: user.name,
        status: user.status,
        capacity: 1,
        role: user.role,
      });
    }
  }

  if (providerType === undefined || providerType === 'resource') {
    const resources = await getResources(businessId);

    for (const resource of resources) {
      if (!includeRemoved && resource.status !== 'active') {
        continue;
      }

      providers.push({
        providerId: resource.id,
        providerType: 'resource',
        businessId: resource.businessId,
        name: resource.name,
        status: resource.status,
        capacity: resource.capacity,
        role: null,
      });
    }
  }

  return providers;
}
