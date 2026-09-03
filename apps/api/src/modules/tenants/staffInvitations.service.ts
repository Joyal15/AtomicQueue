import { createHash, randomBytes } from "node:crypto";
import { Types, type ClientSession } from "mongoose";

import { StaffInvitationModel } from "./staffInvitations.model.js";
// Read-only stopgap import — same accepted pattern providers.service.ts
// already uses for listProviders/validateProvider, until `auth` exports a
// proper read function. Never write through this model from here.
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
 * it can be safely retried once on a concurrent create race (see below).
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
    // Architecture §9b case 3: an accepted invitation means a User already
    // exists for this email — the case-1 check below already covers this
    // in practice, this stays as harmless defense-in-depth.
    if (existing.status === "accepted") {
      const error = new Error(
        "A staff invitation for this email has already been accepted",
      );
      error.name = "STAFF_INVITATION_ALREADY_ACCEPTED";
      throw error;
    }

    // Case 2: pending/expired/revoked -> implicit resend. Overwriting the
    // token hash immediately invalidates whatever the previous token was.
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
    // Two concurrent invites for a brand-new {businessId, email} pair can
    // both pass the findOne check above and race on create() — the loser
    // hits the {businessId, email} unique index. Retry once: the retry's
    // findOne now sees the row the winner just inserted and takes the
    // resend branch instead of create() again. Depth-1 only, no loop risk.
    if (isDuplicateKeyError(error) && !isRetry) {
      return upsertInvitation(input, email, true);
    }

    throw error;
  }
}

/**
 * Create a new staff invitation or resend an existing non-accepted one.
 *
 * Architecture §9b case 1: if the email already belongs to ANY Users row —
 * active or removed, this business or another — invite creation is
 * rejected outright, no exception. Checked before any invitation
 * read/write, since it applies regardless of whether an invitation row
 * exists yet.
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
 * Distinguishes "no such invitation for this business" (404) from
 * "exists but isn't pending" (409) — a plain boolean can't carry that
 * distinction, so this returns a discriminated result instead.
 */
export async function revokeStaffInvitation(
  businessId: string,
  invitationId: string,
): Promise<RevokeStaffInvitationResult> {
  // A malformed id would otherwise throw a Mongoose CastError before the
  // query even runs (same guard class as availability.service.ts's
  // isValidAvailabilityId).
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
  // but isn't pending. One cheap extra read, only on this failure path, to
  // tell those two apart for the caller. This is same-tenant state
  // disclosure ("this invitation isn't pending"), not the cross-tenant
  // enumeration case the always-404 rule (architecture §13) protects
  // against — the caller already owns this business's invitations.
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
 * transaction — the accept half of architecture §9b's acceptance flow.
 *
 * Mirrors tenants.createBusiness's discipline exactly: requires an
 * already-open transaction (throws otherwise), because the invitation's
 * accepted status and the sibling staff User insert are both-or-neither,
 * same as the Business+owner-User write in signup (§4d).
 *
 * Returns null for EVERY failure mode collapsed together on purpose —
 * unknown token, a token a later resend invalidated, revoked, expired
 * (checked live here, no background sweep), or already accepted. This is
 * what lets the caller return one generic 404 (enumeration resistance,
 * architecture §13) without branching on why.
 *
 * On success this has already flipped the invitation to 'accepted' inside
 * the caller's transaction — it has NOT created the User. That insert is
 * the caller's, using the same array-form Model.create([...], { session })
 * pattern signupOwner() already uses for the owner User.
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
