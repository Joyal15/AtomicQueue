import { createHash, randomBytes } from "node:crypto";
import { Types, type ClientSession } from "mongoose";

import { StaffInvitationModel } from "./staffInvitations.model.js";
// Read-only access to the auth module's model. Never write through this
// model from here.
import { UserModel } from "../auth/auth.model.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export interface CreateStaffInvitationInput {
  businessId: string;
  email: string;
  invitedBy: string;
}

export interface CreatedStaffInvitation {
  id: string;
  businessId: string;
  email: string;
  token: string;
  expiresAt: Date;
}

/**
 * The find-or-resend-or-create body of createStaffInvitation, split out so
 * it can be retried once on a concurrent create race.
 */
async function upsertInvitation(
  input: CreateStaffInvitationInput,
  email: string,
  isRetry: boolean,
): Promise<CreatedStaffInvitation> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const existing = await StaffInvitationModel.findOne({
    businessId: input.businessId,
    email,
  });

  if (existing) {
    // An accepted invitation means a User already exists for this email.
    if (existing.status === "accepted") {
      const error = new Error(
        "A staff invitation for this email has already been accepted",
      );
      error.name = "STAFF_INVITATION_ALREADY_ACCEPTED";
      throw error;
    }

    // pending/expired/revoked -> implicit resend; overwriting the token
    // hash invalidates the previous token.
    existing.tokenHash = tokenHash;
    existing.expiresAt = expiresAt;
    existing.status = "pending";
    existing.invitedBy = input.invitedBy;
    existing.acceptedAt = null;

    await existing.save();

    return {
      id: existing._id.toString(),
      businessId: existing.businessId,
      email: existing.email,
      token,
      expiresAt,
    };
  }

  try {
    const invitation = await StaffInvitationModel.create({
      businessId: input.businessId,
      email,
      tokenHash,
      expiresAt,
      status: "pending",
      invitedBy: input.invitedBy,
      acceptedAt: null,
    });

    return {
      id: invitation._id.toString(),
      businessId: invitation.businessId,
      email: invitation.email,
      token,
      expiresAt,
    };
  } catch (error) {
    // Two concurrent invites for the same {businessId, email} can both pass
    // the findOne check and race on create() — the loser hits the unique
    // index. Retry once so it takes the resend branch instead.
    if (isDuplicateKeyError(error) && !isRetry) {
      return upsertInvitation(input, email, true);
    }

    throw error;
  }
}

/**
 * Create a new staff invitation or resend an existing non-accepted one.
 *
 * Rejected outright if the email already belongs to any Users row
 * (active or removed, this business or another).
 */
export async function createStaffInvitation(
  input: CreateStaffInvitationInput,
): Promise<CreatedStaffInvitation> {
  const email = normalizeEmail(input.email);

  const existingUser = await UserModel.findOne({ email })
    .select({ _id: 1 })
    .lean();

  if (existingUser) {
    const error = new Error("An account with this email already exists.");
    error.name = "STAFF_INVITATION_EMAIL_IN_USE";
    throw error;
  }

  return upsertInvitation(input, email, false);
}

export type RevokeStaffInvitationError =
  | "INVITATION_NOT_FOUND"
  | "INVITATION_NOT_PENDING";

export type RevokeStaffInvitationResult =
  | { ok: true }
  | { ok: false; error: RevokeStaffInvitationError };

/**
 * Revoke a pending invitation.
 *
 * Returns a discriminated result so the caller can tell "no such
 * invitation for this business" (404) apart from "exists but isn't
 * pending" (409).
 */
export async function revokeStaffInvitation(
  businessId: string,
  invitationId: string,
): Promise<RevokeStaffInvitationResult> {
  // A malformed id would otherwise throw a Mongoose CastError.
  if (!Types.ObjectId.isValid(invitationId)) {
    return { ok: false, error: "INVITATION_NOT_FOUND" };
  }

  const result = await StaffInvitationModel.updateOne(
    {
      _id: invitationId,
      businessId,
      status: "pending",
    },
    {
      $set: {
        status: "revoked",
      },
    },
  );

  if (result.modifiedCount === 1) {
    return { ok: true };
  }

  // Not modified: either it doesn't exist for this business, or it exists
  // but isn't pending. One extra read to tell those two apart for the
  // caller.
  const exists = await StaffInvitationModel.exists({
    _id: invitationId,
    businessId,
  });

  return {
    ok: false,
    error: exists ? "INVITATION_NOT_PENDING" : "INVITATION_NOT_FOUND",
  };
}

/**
 * List invitations belonging to one business.
 */
export async function getStaffInvitations(
  businessId: string,
) {
  return StaffInvitationModel.find({
    businessId,
  })
    .select(
      "_id businessId email expiresAt status invitedBy acceptedAt createdAt updatedAt",
    )
    .sort({ createdAt: -1 })
    .lean();
}

export interface ConsumedInvitation {
  invitationId: string;
  businessId: string;
  email: string;
}

/**
 * Atomically consumes a raw invitation token inside the caller's
 * transaction — the accept half of the invitation flow.
 *
 * Requires an already-open transaction (throws otherwise), since the
 * invitation's accepted status and the sibling staff User insert must
 * commit together.
 *
 * Returns null for every failure mode (unknown token, invalidated by a
 * later resend, revoked, expired, or already accepted) so the caller can
 * return one generic 404 without branching on why.
 *
 * On success this flips the invitation to 'accepted' but does NOT create
 * the User — that insert is the caller's responsibility, in the same
 * transaction.
 */
export async function consumeInvitation(
  token: string,
  session: ClientSession,
): Promise<ConsumedInvitation | null> {
  if (!session.inTransaction()) {
    throw new Error(
      "consumeInvitation must run inside a transaction: the invitation's " +
        "accepted status and the new staff User are written both-or-neither",
    );
  }

  const tokenHash = hashToken(token);

  const invitation = await StaffInvitationModel.findOneAndUpdate(
    {
      tokenHash,
      status: "pending",
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        status: "accepted",
        acceptedAt: new Date(),
      },
    },
    { session },
  );

  if (!invitation) {
    return null;
  }

  return {
    invitationId: invitation._id.toString(),
    businessId: invitation.businessId,
    email: invitation.email,
  };
}
