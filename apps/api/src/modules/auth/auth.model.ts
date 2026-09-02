import { Schema, model } from 'mongoose';

export interface UserDocument {
  name: string;
  email: string;
  passwordHash: string;
  passwordChangedAt: Date;
  sessionsInvalidatedAt: Date | null;
  role: 'owner' | 'staff';
  businessId: string;
  status: 'active' | 'removed';
}

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    passwordChangedAt: {
      type: Date,
      required: true,
    },

    sessionsInvalidatedAt: {
      type: Date,
      default: null,
    },

    role: {
      type: String,
      enum: ['owner', 'staff'],
      required: true,
    },

    businessId: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['active', 'removed'],
      required: true,
    },
  },
  { timestamps: true },
);

export const UserModel = model<UserDocument>('User', userSchema);