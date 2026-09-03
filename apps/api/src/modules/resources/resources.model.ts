import { Schema, model } from 'mongoose';

/**
 * A bookable resource (e.g. turf, room, equipment). Capacity greater
 * than one means multiple customers can use it at the same time.
 */
export interface ResourceDocument {
  businessId: string;
  name: string;
  type: string;
  capacity: number;
  status: 'active' | 'removed';
}

/**
 * MongoDB schema for resources. `status` lets a resource be retired
 * without deleting its historical record.
 */
const resourceSchema = new Schema<ResourceDocument>(
  {
    businessId: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      required: true,
    },

    capacity: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ['active', 'removed'],
      default: 'active',
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Mongoose model for resources.
 */
export const ResourceModel = model<ResourceDocument>(
  'Resource',
  resourceSchema,
);