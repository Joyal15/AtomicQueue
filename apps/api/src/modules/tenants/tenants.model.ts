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

// Backs the public directory's keyset pagination (GET /api/businesses):
// a deterministic total order on (name asc, _id asc) — `_id` is the
// unique tiebreak so ordering is stable even when two businesses share
// a name. Not a substitute for the sort's correctness, just its index.
businessSchema.index({ name: 1, _id: 1 });

export const BusinessModel = model<BusinessDocument>('Business', businessSchema);