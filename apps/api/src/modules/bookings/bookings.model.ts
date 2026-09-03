import { Schema, model } from 'mongoose';

export type BookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

export type BookingContactType = 'email' | 'phone';

export interface BookingDocument {
  businessId: string;
  slotId: string;

  customer: {
    name: string;
    contactType: BookingContactType;
    contact: string;
  };

  createdBy: string | null;

  status: BookingStatus;

  accessTokenHash?: string;
  accessTokenExpiresAt: Date | null;

  noShowRiskNote: string | null;

  createdAt: Date;
  cancelledAt: Date | null;
}

const bookingSchema = new Schema<BookingDocument>(
  {
    businessId: {
      type: String,
      required: true,
      index: true,
    },

    slotId: {
      type: String,
      required: true,
      index: true,
    },

    customer: {
      name: {
        type: String,
        required: true,
        trim: true,
      },

      contactType: {
        type: String,
        enum: ['email', 'phone'],
        required: true,
      },

      contact: {
        type: String,
        required: true,
        trim: true,
      },
    },

    createdBy: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ['confirmed', 'cancelled', 'completed', 'no-show'],
      required: true,
      default: 'confirmed',
    },

    accessTokenHash: {
      type: String,
      default: undefined,
    },

    accessTokenExpiresAt: {
      type: Date,
      default: null,
    },

    noShowRiskNote: {
      type: String,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);

/**
 * A booking can have only one active confirmed booking
 * for a given business + slot.
 */
bookingSchema.index(
  { businessId: 1, slotId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'confirmed',
    },
  },
);

/**
 * Access-token hashes must be unique, but bookings without
 * an email/access token must not collide with each other.
 */
bookingSchema.index(
  { accessTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      accessTokenHash: { $exists: true },
    },
  },
);

export const BookingModel = model<BookingDocument>(
  'Booking',
  bookingSchema,
);