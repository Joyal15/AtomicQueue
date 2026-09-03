import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { createSession, deleteSession } from "./auth.session.js";
import { UserModel } from "./auth.model.js";
import { createBusiness } from "../tenants/tenants.service.js";
import { AppError } from "../../lib/Apperror.js";
import {
  recordLoginFailure,
  recordIpLoginFailure,
  resetLoginFailures,
  resetIpLoginFailures,

} from './auth.rateLimit.js';
import { consumeInvitation } from "../tenants/staffInvitations.service.js";

export interface SignupOwnerInput {
  name: string;
  email: string;
  password: string;
  businessName: string;
}

export interface SignupOwnerResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: "owner";
    businessId: string;
    status: "active";
  };
  business: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
  };
  sessionId: string;
}

export interface LoginInput {
  email: string;
  password: string;
  ipAddress: string;
}

export interface LoginResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: "owner" | "staff";
    businessId: string;
    status: "active";
  };
  sessionId: string;
}

export interface AcceptStaffInvitationInput {
  token: string;
  name: string;
  password: string;
}

export interface AcceptStaffInvitationResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: "staff";
    businessId: string;
    status: "active";
  };
  sessionId: string;
}

const MAX_SLUG_RETRIES = 3;
const DUMMY_PASSWORD_HASH = '2b$12$435mxxNOmm8fanBS.ZnGlufOVhDPRmAhuIs51XuvT0.kFCTPGL9fm';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateSlug(businessName: string): string {
  const base = slugify(businessName);

  if (!base) {
    throw new Error("Business name cannot produce a valid slug");
  }

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isDuplicateSlugError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) {
    return false;
  }

  if ("keyPattern" in error) {
    const keyPattern = (
      error as {
        keyPattern?: Record<string, unknown>;
      }
    ).keyPattern;

    if (keyPattern?.slug) {
      return true;
    }
  }

  if ("keyValue" in error) {
    const keyValue = (
      error as {
        keyValue?: Record<string, unknown>;
      }
    ).keyValue;

    if (keyValue?.slug) {
      return true;
    }
  }

  return false;
}

function isDuplicateEmailError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;

  if ('keyPattern' in error) {
    const keyPattern = (error as { keyPattern?: Record<string, unknown> })
      .keyPattern;

    if (keyPattern?.email) return true;
  }

  if ('keyValue' in error) {
    const keyValue = (error as { keyValue?: Record<string, unknown> })
      .keyValue;

    if (keyValue?.email) return true;
  }

  return false;
}

/**
 * Creates an owner account and its Business in one transaction (both
 * committed or both rolled back).
 */
export async function signupOwner(
  input: SignupOwnerInput,
): Promise<SignupOwnerResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, 12);

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt += 1) {
    const ownerId = new mongoose.Types.ObjectId().toString();
    const businessId = new mongoose.Types.ObjectId().toString();
    const slug = generateSlug(input.businessName);

    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      await UserModel.create(
        [
          {
            _id: ownerId,
            name: input.name,
            email: normalizedEmail,
            passwordHash,
            passwordChangedAt: new Date(),
            sessionsInvalidatedAt: null,
            role: "owner",
            businessId,
            status: "active",
          },
        ],
        { session },
      );

      const business = await createBusiness(
        {
          id: businessId,
          name: input.businessName,
          slug,
          ownerId,
          timezone: "UTC",
          cancellationCutoffMinutes: 60,
        },
        session,
      );

      await session.commitTransaction();
      const authSession = await createSession(ownerId);

      return {
        user: {
          id: ownerId,
          name: input.name,
          email: normalizedEmail,
          role: "owner",
          businessId,
          status: "active",
        },
        business,
        sessionId: authSession.sessionId,
      };
    } catch (error) {
      await session.abortTransaction();

      if (isDuplicateEmailError(error)) {
        throw new AppError(
          409,
          'EMAIL_ALREADY_EXISTS',
          'An account with that email already exists.',
        );
      }
      if (isDuplicateSlugError(error) && attempt < MAX_SLUG_RETRIES - 1) {
        continue;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw new Error("Unable to create business after slug retry limit");
}

export async function acceptStaffInvitation(
  input: AcceptStaffInvitationInput,
): Promise<AcceptStaffInvitationResult> {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const consumedInvitation = await consumeInvitation(
      input.token,
      session,
    );

    if (!consumedInvitation) {
      throw new AppError(
        404,
        "INVITATION_NOT_FOUND",
        "Invitation not found or is no longer valid.",
      );
    }

    const userId = new mongoose.Types.ObjectId().toString();
    const passwordChangedAt = new Date();

    await UserModel.create(
      [
        {
          _id: userId,
          name: input.name,
          email: consumedInvitation.email,
          passwordHash,
          passwordChangedAt,
          sessionsInvalidatedAt: null,
          role: "staff",
          businessId: consumedInvitation.businessId,
          status: "active",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    const authSession = await createSession(userId);

    return {
      user: {
        id: userId,
        name: input.name,
        email: consumedInvitation.email,
        role: "staff",
        businessId: consumedInvitation.businessId,
        status: "active",
      },
      sessionId: authSession.sessionId,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isDuplicateEmailError(error)) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_EXISTS",
        "An account with that email already exists.",
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

export async function login(
  input: LoginInput,
): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(input.email);

  const user = await UserModel.findOne({
    email: normalizedEmail,
  });

  if (!user) {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);

    const accountAllowed = await recordLoginFailure(normalizedEmail);
    const ipAllowed = await recordIpLoginFailure(input.ipAddress);

    if (!accountAllowed || !ipAllowed) {
      throw new AppError(
        429,
        'LOGIN_RATE_LIMITED',
        'Too many login attempts. Please try again later.',
      );
    }

    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password.',
    );
  }

  const passwordMatches = await bcrypt.compare(
    input.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    const accountAllowed = await recordLoginFailure(normalizedEmail);
    const ipAllowed = await recordIpLoginFailure(input.ipAddress);

    if (!accountAllowed || !ipAllowed) {
      throw new AppError(
        429,
        'LOGIN_RATE_LIMITED',
        'Too many login attempts. Please try again later.',
      );
    }

    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password.',
    );
  }

  if (user.status !== 'active') {
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password.',
    );
  }

  await resetLoginFailures(normalizedEmail);
  await resetIpLoginFailures(input.ipAddress);

  const authSession = await createSession(String(user._id));

  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
      status: user.status,
    },
    sessionId: authSession.sessionId,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
}

export async function logoutEverywhere(userId: string): Promise<void> {
  await UserModel.findByIdAndUpdate(userId, {
    $set: {
      sessionsInvalidatedAt: new Date(),
    },
  });
}