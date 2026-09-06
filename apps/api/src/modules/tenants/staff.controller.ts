/**
 * HTTP controllers for staff member management: listing, removal, and
 * reactivation. Owner-only, same as the invitation flow in
 * `staffInvitations.controller.ts`.
 */

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';
import { requireRole } from '../../lib/requireRole.js';

import {
  listStaffMembers,
  removeStaffMember,
  reactivateStaffMember,
} from './staff.service.js';

/**
 * Lists this business's staff accounts, active and removed alike.
 */
export const listStaffMembersController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  const staff = await listStaffMembers(req.user.businessId);

  return res.status(200).json({
    data: staff,
  });
});

/**
 * Removes a staff member — the transactional cascade in
 * `staff.service.ts` (architecture doc §9b). 404 if the account doesn't
 * exist for this business, isn't a staff role, or is already removed.
 */
export const removeStaffMemberController = asyncHandler<{ userId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;
    if (!requireRole(req, res, 'owner')) return;

    const member = await removeStaffMember(req.user.businessId, req.params.userId);

    if (!member) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Staff member not found or already removed',
        },
      });
    }

    return res.status(200).json({
      data: member,
    });
  },
);

/**
 * Reactivates a previously removed staff member. Explicit,
 * non-cascading — see `reactivateStaffMember`'s doc comment.
 */
export const reactivateStaffMemberController = asyncHandler<{ userId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;
    if (!requireRole(req, res, 'owner')) return;

    const member = await reactivateStaffMember(req.user.businessId, req.params.userId);

    if (!member) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Staff member not found or not currently removed',
        },
      });
    }

    return res.status(200).json({
      data: member,
    });
  },
);
