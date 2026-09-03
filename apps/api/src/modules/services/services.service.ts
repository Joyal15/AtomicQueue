import type { Service } from '@queueless/shared-types';

import { ServiceModel } from './services.model.js';

/**
 * Input required to create a service (something a business offers
 * for customers to book, e.g. "Badminton Court").
 */
export interface CreateServiceInput {
  businessId: string;
  name: string;
  durationMinutes: number;
  price: number;
}

/**
 * Creates a new service. isActive defaults to true via the schema.
 */
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

/**
 * Gets all services belonging to a business.
 */
export async function getServices(
  businessId: string,
): Promise<Service[]> {
  const services = await ServiceModel.find({ businessId }).lean();

  return services.map((service) => ({
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  }));
}

/**
 * Input required to update an existing service.
 */
export interface UpdateServiceInput {
  businessId: string;
  serviceId: string;
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
}

/**
 * Updates an existing service. Returns null if no service matches
 * both the ID and businessId.
 */
export async function updateService(
  input: UpdateServiceInput,
): Promise<Service | null> {
  const service = await ServiceModel.findOneAndUpdate(
    {
      _id: input.serviceId,
      businessId: input.businessId,
    },
    {
      name: input.name,
      durationMinutes: input.durationMinutes,
      price: input.price,
      isActive: input.isActive,
    },
    { new: true },
  );

  if (!service) {
    return null;
  }

  return {
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  };
}

/**
 * Deactivates a service (soft-disable) instead of deleting it, so
 * historical bookings and slots can still reference it.
 */
export async function deactivateService(
  businessId: string,
  serviceId: string,
): Promise<Service | null> {
  const service = await ServiceModel.findOneAndUpdate(
    {
      _id: serviceId,
      businessId,
    },
    {
      isActive: false,
    },
    { new: true },
  );

  if (!service) {
    return null;
  }

  return {
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  };
}

/**
 * Gets one service by ID, scoped to a business. Returns null if not found.
 */
export async function getServiceById(
  businessId: string,
  serviceId: string,
): Promise<Service | null> {
  const service = await ServiceModel.findOne({
    _id: serviceId,
    businessId,
  }).lean();

  if (!service) {
    return null;
  }

  return {
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  };
}