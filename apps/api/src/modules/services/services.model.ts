import { Schema, model } from 'mongoose';

export interface ServiceDocument {
  businessId: string;
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
}

const serviceSchema = new Schema<ServiceDocument>(
  {
    businessId: { type: String, required: true },
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    price: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const ServiceModel = model<ServiceDocument>(
  'Service',
  serviceSchema,
);