/**
 * Domain types for the Providers module.
 *
 * There is deliberately NO Mongoose model in this file. "Provider"
 * is a domain concept, not a persisted collection (architecture doc
 * Section 2, "Provider is a domain concept, not a persisted
 * collection" / Section 2b):
 *
 *   - a staff provider IS a `Users` row  (owned by the `auth` module)
 *   - a resource provider IS a `Resources` row (owned by `resources`)
 *
 * This module only resolves and unifies that polymorphic
 * `providerId` + `providerType` reference — it stores nothing of
 * its own. The file exists to hold the single read shape the
 * service layer projects both kinds into, so callers (a dashboard
 * list, the availability provider picker) work against one type.
 */

import type { ProviderType } from '@queueless/shared-types';

/**
 * The two-state lifecycle shared, field-for-field, by both provider
 * kinds — staff removal (Section 9b) and resource retirement
 * (Section 9c) are deliberately the same design.
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
   * Interchangeable parallel units (architecture doc Section 2 /
   * 4b). Always 1 for a staff provider; 1..N for a resource. Kept
   * on the projection so a picker can show "3 courts" without a
   * second query.
   */
  capacity: number;
  /**
   * `Users.role` when `providerType === 'staff'`; `null` for a
   * resource. An owner can act as a provider without a separate
   * staff account (Section 2 / 9).
   */
  role: 'owner' | 'staff' | null;
}
