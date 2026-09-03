/**
 * Service layer for the Providers module.
 *
 * "Provider" is a domain concept, not a collection — a staff provider is
 * a `Users` row, a resource provider is a `Resources` row.
 * `providerId` + `providerType` is a polymorphic reference that MongoDB
 * can't enforce as a foreign key, so this module owns the one function
 * that resolves and checks it safely.
 *
 * `validateProvider` is called by every write path that sets or changes
 * a `providerId`/`providerType` pair.
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
 * Kept as a named predicate rather than an inline check so "eligible to
 * be a provider" can diverge from "has role X" later without hunting
 * down every comparison. An owner is eligible today, same as staff.
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
    /** Row exists but status !== 'active'. */
    | 'PROVIDER_REMOVED'
    /** Staff row whose role can't be a provider. */
    | 'PROVIDER_INELIGIBLE';
}

export type ProviderValidationResult =
  | ProviderValidationSuccess
  | ProviderValidationFailure;

/**
 * Verifies, in order:
 *   1. a document with that `_id` exists in the collection implied by
 *      `providerType`,
 *   2. it belongs to the caller's `businessId`,
 *   3. it is currently active (`status === 'active'`),
 *   4. for `providerType: 'staff'`, the role is eligible to be a
 *      provider.
 *
 * A cross-tenant lookup fails as `PROVIDER_NOT_FOUND`, same as a
 * genuinely missing row, so a caller can't tell "exists elsewhere"
 * apart from "doesn't exist".
 */
export async function validateProvider(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
): Promise<ProviderValidationResult> {
  // A malformed id string would make `findOne` throw a CastError; treat
  // it as simply not found.
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

    // Role checked before status, so an ineligible-and-inactive account
    // reads as INELIGIBLE rather than REMOVED.
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

  // Unreachable given the ProviderType union; guards against a bad cast
  // at a call site.
  return { ok: false, error: 'PROVIDER_NOT_FOUND' };
}

export interface ListProvidersOptions {
  /** Restrict to one kind. Omitted → both staff and resources. */
  providerType?: ProviderType;
  /**
   * Also return removed providers. Default false: a picker only wants
   * currently-bookable providers.
   */
  includeRemoved?: boolean;
}

/**
 * Lists a business's providers — staff and resources alike — projected
 * into the unified `Provider` shape.
 *
 *   - Staff: `Users` rows filtered to provider-eligible roles via
 *     `isProviderEligibleRole`, the same predicate `validateProvider`
 *     uses.
 *   - Resources: fetched via the `resources` module's `getResources`
 *     rather than a direct model read, to keep the module boundary
 *     intact.
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
