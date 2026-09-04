/**
 * HTTP controllers for the StaffInvitations flow.
 *
 * Owner-only send/list/revoke. Accepting an invitation is handled
 * elsewhere (it creates a `User`), built on this module's exported
 * `consumeInvitation()`.
 *
 * Every handler is wrapped in `asyncHandler` so a rejected promise
 * reaches `errorHandler` instead of leaving the request hanging.
 */

import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';
import { requireRole } from '../../lib/requireRole.js';

import {
  createStaffInvitation,
  getStaffInvitations,
  revokeStaffInvitation,
} from './staffInvitations.service.js';

/**
 * Body schema for POST /invitations, enforced by `validate()` at the
 * router level before this controller runs.
 */
export const createStaffInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.'),
});

/**
 * Handles the HTTP request for inviting a staff member by email.
 *
 * businessId and invitedBy come from the authenticated owner's session,
 * never the request body.
 */
export const createStaffInvitationController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  try {
    const invitation = await createStaffInvitation({
      businessId: req.user.businessId,
      email: req.body.email,
      invitedBy: req.user.userId,
    });

    return res.status(201).json({
      data: {
        id: invitation.id,
        businessId: invitation.businessId,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'STAFF_INVITATION_EMAIL_IN_USE' ||
        error.name === 'STAFF_INVITATION_ALREADY_ACCEPTED')
    ) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists.',
        },
      });
    }

    throw error;
  }
});

/**
 * Handles the HTTP request for listing the authenticated business's
 * staff invitations (every status — pending, accepted, revoked, expired).
 */
export const listStaffInvitationsController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  const invitations = await getStaffInvitations(req.user.businessId);

  return res.status(200).json({
    data: invitations.map((invitation) => ({
      id: String(invitation._id),
      businessId: invitation.businessId,
      email: invitation.email,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
    })),
  });
});

/**
 * Handles the HTTP request for revoking a pending staff invitation.
 *
 * 404 when the invitation doesn't exist for this business; 409 when it
 * exists but isn't pending (already accepted/revoked/expired).
 */
export const revokeStaffInvitationController = asyncHandler<{ invitationId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;
    if (!requireRole(req, res, 'owner')) return;

    const result = await revokeStaffInvitation(
      req.user.businessId,
      req.params.invitationId,
    );

    if (!result.ok) {
      if (result.error === 'INVITATION_NOT_FOUND') {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Invitation not found',
          },
        });
      }

      return res.status(409).json({
        error: {
          code: 'INVITATION_NOT_PENDING',
          message:
            'This invitation is no longer pending and cannot be revoked.',
        },
      });
    }

    return res.status(200).json({
      data: {
        id: req.params.invitationId,
        status: 'revoked',
      },
    });
  },
);
