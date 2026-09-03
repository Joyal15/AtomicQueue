/**
 * HTTP controllers for the StaffInvitations flow.
 *
 * Owner-only send/list/revoke. Accepting an invitation is handled
 * elsewhere (it creates a `User`), built on this module's exported
 * `consumeInvitation()`.
 *
 * Every handler wraps its body in try/catch + next(error), since Express 4
 * does not auto-catch a rejected promise from an async handler.
 */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

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
export async function createStaffInvitationController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

    return next(error);
  }
}

/**
 * Handles the HTTP request for listing the authenticated business's
 * staff invitations (every status — pending, accepted, revoked, expired).
 */
export async function listStaffInvitationsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  try {
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
  } catch (error) {
    return next(error);
  }
}

/**
 * Handles the HTTP request for revoking a pending staff invitation.
 *
 * 404 when the invitation doesn't exist for this business; 409 when it
 * exists but isn't pending (already accepted/revoked/expired).
 */
export async function revokeStaffInvitationController(
  req: Request<{ invitationId: string }>,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  try {
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
  } catch (error) {
    return next(error);
  }
}
