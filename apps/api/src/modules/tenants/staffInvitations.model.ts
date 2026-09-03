import { Schema, model } from 'mongoose';
export type StaffInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';
export interface StaffInvitationDocument {
  businessId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  status: StaffInvitationStatus;
  invitedBy: string;
  acceptedAt: Date | null;
}

const staffInvitationSchema = new Schema<StaffInvitationDocument>(
  {
    businessId: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    tokenHash: {
      type: String,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      required: true,
      default: 'pending',
    },

    invitedBy: {
      type: String,
      required: true,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

staffInvitationSchema.index(
  { businessId: 1, email: 1 },
  { unique: true },
);

staffInvitationSchema.index(
  { tokenHash: 1 },
  { unique: true },
);

export const StaffInvitationModel = model<StaffInvitationDocument>(
  'StaffInvitation',
  staffInvitationSchema,
);