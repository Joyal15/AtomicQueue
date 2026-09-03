/**
 * Domain types for the Providers module.
 *
 * There is no Mongoose model here. "Provider" is a domain concept, not a
 * persisted collection: a staff provider IS a `Users` row (owned by
 * `auth`), a resource provider IS a `Resources` row (owned by
 * `resources`). This module just resolves and unifies that polymorphic
 * `providerId` + `providerType` reference into one shape callers can use.
 */

import type { ProviderType } from '@queueless/shared-types';

/**
 * The two-state lifecycle shared by both provider kinds (staff removal
 * and resource retirement use the same states).
 */
export type ProviderStatus = 'active' | 'removed';

/**
 * A staff member or a resource, projected into one shape.
 *
 * `providerId` + `providerType` together are exactly the reference
 * persisted on `ProviderAvailability` and `Slots`.
 */
export interface Provider {
  /** `Users._id` (staff) or `Resources._id` (resource), as a string. */
  providerId: string;
  providerType: ProviderType;
  businessId: string;
  /** `Users.name` for staff, `Resources.name` for a resource. */
  name: string;
  status: ProviderStatus;
  /**
   * Interchangeable parallel units. Always 1 for a staff provider; 1..N
   * for a resource. Lets a picker show "3 courts" without a second query.
   */
  capacity: number;
  /**
   * `Users.role` when `providerType === 'staff'`; `null` for a resource.
   * An owner can act as a provider without a separate staff account.
   */
  role: 'owner' | 'staff' | null;
}
