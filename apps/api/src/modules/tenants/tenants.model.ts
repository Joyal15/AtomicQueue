import { Schema, model } from 'mongoose';

export interface BusinessDocument {
  name: string;
  slug: string;
  ownerId: string;
  timezone: string;
  cancellationCutoffMinutes: number;
}

const businessSchema = new Schema<BusinessDocument>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },

    timezone: { type: String, required: true },
    cancellationCutoffMinutes: { type: Number, required: true },
  },
  { timestamps: true },
);

export const BusinessModel = model<BusinessDocument>('Business', businessSchema);