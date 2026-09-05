import { Schema, model } from 'mongoose';

export type WaitlistStatus =
  | 'waiting'
  | 'notified'
  | 'expired'
  | 'converted';

export interface WaitlistEntryDocument {
  businessId: string;

  customer: {
    name: string;
    contact: string;
  };

  desiredServiceId: string;
  desiredProviderId?: string;

  status: WaitlistStatus;

  notifiedAt?: Date;

  createdAt: Date;
}

const waitlistEntrySchema = new Schema<WaitlistEntryDocument>(
  {
    businessId: {
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

      contact: {
        type: String,
        required: true,
        trim: true,
      },
    },

    desiredServiceId: {
      type: String,
      required: true,
      index: true,
    },

    desiredProviderId: {
      type: String,
      default: undefined,
    },

    status: {
      type: String,
      enum: ['waiting', 'notified', 'expired', 'converted'],
      required: true,
      default: 'waiting',
      index: true,
    },

    notifiedAt: {
      type: Date,
      default: undefined,
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
 * Matching is FIFO within a service/provider preference.
 */
waitlistEntrySchema.index({
  businessId: 1,
  desiredServiceId: 1,
  status: 1,
  createdAt: 1,
});

export const WaitlistEntryModel = model<WaitlistEntryDocument>(
  'WaitlistEntry',
  waitlistEntrySchema,
);