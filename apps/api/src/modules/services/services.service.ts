import type { Service } from '@queueless/shared-types';
import { ServiceModel } from './services.model.js';

export interface CreateServiceInput {
  businessId: string;
  name: string;
  durationMinutes: number;
  price: number;
}

export async function createService(
  input: CreateServiceInput,
): Promise<Service> {
  const service = await ServiceModel.create({
    businessId: input.businessId,
    name: input.name,
    durationMinutes: input.durationMinutes,
    price: input.price,
  });

  return {
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  };
}