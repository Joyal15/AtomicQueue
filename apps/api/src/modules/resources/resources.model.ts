import { Schema, model } from 'mongoose';

/**
 * Represents a resource that can be booked.
 *
 * Resources are treated as providers in QueueLess++.
 *
 * Examples:
 * - Turf
 * - Room
 * - Equipment
 *
 * A resource can have a capacity greater than one when multiple
 * customers can use the same resource at the same time.
 */
export interface ResourceDocument {
  businessId: string;
  name: string;
  type: string;
  capacity: number;
  status: 'active' | 'removed';
}

/**
 * MongoDB schema for resources.
 *
 * businessId ensures every resource belongs to a specific business.
 *
 * status allows resources to be retired without permanently
 * deleting their historical record.
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
 * Mongoose model used to create and query resources.
 */
export const ResourceModel = model<ResourceDocument>(
  'Resource',
  resourceSchema,
);