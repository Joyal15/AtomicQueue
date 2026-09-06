/**
 * Staff member management — listing plus the removal/reactivation
 * cascade (architecture doc §9b).
 *
 * Reads `UserModel` directly (read-only), the same convention already
 * used by `staffInvitations.service.ts` and the `providers` module.
 * Never writes through it — the one write this module needs
 * (`Users.status`) goes through `setStaffStatus`, exported by the `auth`
 * module, so this module never mutates a document it doesn't own.
 */

import mongoose, { Types } from 'mongoose';

import { UserModel } from '../auth/auth.model.js';
import { setStaffStatus } from '../auth/index.js';
import {
  cancelFutureSlotsForProvider,
  emitBulkSlotUpdates,
  type SlotStatus,
} from '../slots/index.js';
import { removeAvailabilityForProvider } from '../availability/index.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'removed';
}

/**
 * Lists a business's staff accounts (role: 'staff' — the owner's own
 * account isn't part of this list). Both active and removed accounts are
 * returned so the dashboard can show a removed member and offer
 * reactivation.
 */
export async function listStaffMembers(
  businessId: string,
): Promise<StaffMember[]> {
  const users = await UserModel.find({ businessId, role: 'staff' })
    .select({ _id: 1, name: 1, email: 1, status: 1 })
    .sort({ name: 1 })
    .lean();

  return users.map((user) => ({
    id: String(user._id),
    name: user.name,
    email: user.email,
    status: user.status,
  }));
}

/**
 * Removes a staff member: one transaction flips `Users.status` to
 * 'removed', deletes their `ProviderAvailability` templates, and cancels
 * their future available/held slots (`holdVersion` cleared on held ones).
 * Confirmed future bookings are deliberately left untouched — they
 * surface as a manual follow-up list elsewhere, never auto-cancelled or
 * reassigned (same rule as resource retirement / service deactivation).
 *
 * Idempotent no-op: returns `null` immediately, without opening a
 * transaction, if the account doesn't exist for this business, isn't a
 * staff role, or is already removed.
 */
export async function removeStaffMember(
  businessId: string,
  userId: string,
): Promise<StaffMember | null> {
  if (!Types.ObjectId.isValid(userId)) {
    return null;
  }

  const existing = await UserModel.findOne({
    _id: userId,
    businessId,
    role: 'staff',
    status: 'active',
  })
    .select({ _id: 1 })
    .lean();

  if (!existing) {
    return null;
  }

  const session = await mongoose.startSession();
  let affected: { slotId: string; status: SlotStatus }[] = [];
  let updated: StaffMember | null = null;

  try {
    await session.withTransaction(async () => {
      await removeAvailabilityForProvider(businessId, userId, 'staff', session);

      const result = await cancelFutureSlotsForProvider(
        businessId,
        userId,
        'staff',
        session,
      );
      affected = result.affected;

      updated = await setStaffStatus(businessId, userId, 'active', 'removed', session);
    });
  } finally {
    await session.endSession();
  }

  // Post-commit only, same rule as the resource/service cascades.
  if (updated) {
    emitBulkSlotUpdates(businessId, affected);
  }

  return updated;
}

/**
 * Reactivates a previously removed staff member. Explicit,
 * non-cascading — resurrects nothing (no un-blocking specific slots, no
 * restored availability templates, no restored sessions).
 */
export async function reactivateStaffMember(
  businessId: string,
  userId: string,
): Promise<StaffMember | null> {
  if (!Types.ObjectId.isValid(userId)) {
    return null;
  }

  return setStaffStatus(businessId, userId, 'removed', 'active');
}
