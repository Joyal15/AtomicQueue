import { AppError } from '../../lib/Apperror.js';
import { getSlotById } from '../slots/index.js';
import {
  WaitlistEntryModel,
  type WaitlistStatus,
} from './waitlist.model.js';

export interface JoinWaitlistInput {
  businessId: string;

  customer: {
    name: string;
    contact: string;
  };

  desiredServiceId: string;
  desiredProviderId?: string;
}

export interface WaitlistEntryItem {
  id: string;
  businessId: string;
  customer: {
    name: string;
    contact: string;
  };
  desiredServiceId: string;
  desiredProviderId: string | null;
  status: WaitlistStatus;
  createdAt: string;
}

function toWaitlistItem(
  entry: WaitlistEntryDocumentLike,
): WaitlistEntryItem {
  return {
    id: String(entry._id),
    businessId: entry.businessId,
    customer: {
      name: entry.customer.name,
      contact: entry.customer.contact,
    },
    desiredServiceId: entry.desiredServiceId,
    desiredProviderId: entry.desiredProviderId ?? null,
    status: entry.status,
    createdAt: entry.createdAt.toISOString(),
  };
}

type WaitlistEntryDocumentLike = {
  _id: unknown;
  businessId: string;
  customer: {
    name: string;
    contact: string;
  };
  desiredServiceId: string;
  desiredProviderId?: string;
  status: WaitlistStatus;
  createdAt: Date;
};

/**
 * Adds a customer to the FIFO waitlist.
 */
export async function joinWaitlist(
  input: JoinWaitlistInput,
): Promise<WaitlistEntryItem> {
  const name = input.customer.name.trim();
  const contact = input.customer.contact.trim();

  if (!name || !contact) {
    throw new AppError(
      400,
      'INVALID_CUSTOMER',
      'Customer name and contact are required.',
    );
  }

  if (!input.desiredServiceId) {
    throw new AppError(
      400,
      'INVALID_SERVICE',
      'A desired service is required.',
    );
  }

  const entry = await WaitlistEntryModel.create({
    businessId: input.businessId,
    customer: {
      name,
      contact,
    },
    desiredServiceId: input.desiredServiceId,
    desiredProviderId: input.desiredProviderId,
    status: 'waiting',
  });

  return toWaitlistItem(entry);
}

/**
 * Lists active waitlist entries for a business.
 * FIFO order is preserved.
 */
export async function listWaitlist(
  businessId: string,
): Promise<WaitlistEntryItem[]> {
  const entries = await WaitlistEntryModel.find({
    businessId,
    status: {
      $in: ['waiting', 'notified'],
    },
  })
    .sort({ createdAt: 1 })
    .lean();

  return entries.map(toWaitlistItem);
}

/**
 * Finds the next waiting customer for a slot.
 *
 * Matching:
 * - same business
 * - same service
 * - optional provider preference must match exactly
 * - FIFO by createdAt
 *
 * This function only identifies the candidate. It does not reserve
 * the slot and does not send a notification.
 */
export async function findNextMatchingWaitlistEntry(
  businessId: string,
  slotId: string,
): Promise<WaitlistEntryItem | null> {
  const slot = await getSlotById(businessId, slotId);

  if (!slot || slot.status !== 'available') {
    return null;
  }

  const entry = await WaitlistEntryModel.findOne({
    businessId,
    desiredServiceId: slot.serviceId,
    status: 'waiting',
    $or: [
      { desiredProviderId: slot.providerId },
      { desiredProviderId: { $exists: false } },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!entry) {
    return null;
  }

  return toWaitlistItem(entry);
}

/**
 * Marks one waitlist entry as notified.
 *
 * The conditional status check prevents two workers from notifying
 * the same waiting entry concurrently.
 */
export async function markWaitlistEntryNotified(
  entryId: string,
): Promise<WaitlistEntryItem | null> {
  const entry = await WaitlistEntryModel.findOneAndUpdate(
    {
      _id: entryId,
      status: 'waiting',
    },
    {
      $set: {
        status: 'notified',
      },
    },
    {
      new: true,
    },
  ).lean();

  if (!entry) {
    return null;
  }

  return toWaitlistItem(entry);
}