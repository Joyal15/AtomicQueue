import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import { UserModel } from './auth.model.js';
import { createBusiness } from '../tenants/tenants.service.js';

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
    role: 'owner';
    businessId: string;
    status: 'active';
  };
  business: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
  };
}

const MAX_SLUG_RETRIES = 3;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateSlug(businessName: string): string {
  const base = slugify(businessName);

  if (!base) {
    throw new Error('Business name cannot produce a valid slug');
  }

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isDuplicateSlugError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) {
    return false;
  }

  if ('keyPattern' in error) {
    const keyPattern = (error as {
      keyPattern?: Record<string, unknown>;
    }).keyPattern;

    if (keyPattern?.slug) {
      return true;
    }
  }

  if ('keyValue' in error) {
    const keyValue = (error as {
      keyValue?: Record<string, unknown>;
    }).keyValue;

    if (keyValue?.slug) {
      return true;
    }
  }

  return false;
}

/**
 * Create an owner account and its Business atomically.
 *
 * Signup is business creation. The owner User and Business must either both
 * be committed or both be rolled back.
 *
 * Auth owns the transaction and pre-generates both document IDs so that the
 * User can reference the Business before either document is inserted.
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
            role: 'owner',
            businessId,
            status: 'active',
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
        },
        session,
      );

      await session.commitTransaction();

      return {
        user: {
          id: ownerId,
          name: input.name,
          email: normalizedEmail,
          role: 'owner',
          businessId,
          status: 'active',
        },
        business,
      };
    } catch (error) {
      await session.abortTransaction();

      if (
        isDuplicateSlugError(error) &&
        attempt < MAX_SLUG_RETRIES - 1
      ) {
        continue;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw new Error('Unable to create business after slug retry limit');
}

