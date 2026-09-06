import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  getTenantsStatus,
  getMyBusinessController,
  updateMyBusinessController,
  updateBusinessSchema,
} from './tenants.controller.js';
import {
  createStaffInvitationController,
  createStaffInvitationSchema,
  listStaffInvitationsController,
  revokeStaffInvitationController,
} from './staffInvitations.controller.js';
import {
  listStaffMembersController,
  removeStaffMemberController,
  reactivateStaffMemberController,
} from './staff.controller.js';

const router = Router();

router.use(authenticate);

router.get('/status', getTenantsStatus);

// GET /api/tenants — view the authenticated user's own business.
// Owner or staff.
router.get('/', getMyBusinessController);

// PATCH /api/tenants — owner-only partial update of name/timezone/
// cancellationCutoffMinutes. slug and ownerId are not editable here.
router.patch('/', validate(updateBusinessSchema), updateMyBusinessController);

// POST /api/tenants/invitations — owner-only. 400 malformed email,
// 403 non-owner, 409 email already belongs to a User (any business/status)
// or an already-accepted invitation.
router.post(
  '/invitations',
  validate(createStaffInvitationSchema),
  createStaffInvitationController,
);

// GET /api/tenants/invitations — owner-only, lists this business's
// invitations across every status.
router.get('/invitations', listStaffInvitationsController);

// DELETE /api/tenants/invitations/:invitationId — owner-only revoke.
// 404 missing/cross-tenant, 409 not pending.
router.delete('/invitations/:invitationId', revokeStaffInvitationController);

// GET /api/tenants/staff — owner-only, lists this business's staff
// accounts (active and removed).
router.get('/staff', listStaffMembersController);

// PATCH /api/tenants/staff/:userId/remove — owner-only. Transactional
// cascade (architecture doc §9b): status -> 'removed', availability
// deleted, future available/held slots cancelled. Confirmed bookings
// untouched.
router.patch('/staff/:userId/remove', removeStaffMemberController);

// PATCH /api/tenants/staff/:userId/reactivate — owner-only, non-cascading.
router.patch('/staff/:userId/reactivate', reactivateStaffMemberController);

export default router;
