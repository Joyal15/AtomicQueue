import type { Service } from '@queueless/shared-types';

import { ServiceModel } from './services.model.js';

/**
 * Defines the information required to create a new service.
 *
 * A service belongs to one business and describes something
 * that customers can book, such as "Badminton Court" or
 * "Coaching Session".
 */
export interface CreateServiceInput {
  businessId: string;
  name: string;
  durationMinutes: number;
  price: number;
}

/**
 * Creates a new service in MongoDB.
 *
 * The businessId makes the service belong to a specific business.
 * isActive is not provided here because the Mongoose model
 * automatically defaults it to true.
 *
 * Returns the newly created service using the shared Service type.
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

  // Convert the MongoDB document into our shared Service shape.
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
 * Gets all services belonging to a specific business.
 *
 * businessId is required so that we never accidentally return
 * services belonging to another business.
 *
 * Returns an array of Service objects.
 */
export async function getServices(
  businessId: string,
): Promise<Service[]> {
  // Only find services that belong to this business.
  const services = await ServiceModel.find({ businessId }).lean();

  // Convert each MongoDB document into the shared Service type.
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
 * Defines the information required to update an existing service.
 *
 * serviceId identifies which service should be changed.
 * businessId ensures that the service belongs to the correct business.
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
 * Updates an existing service.
 *
 * The service must belong to the business provided in businessId.
 * If no matching service is found, the function returns null.
 *
 * Returns the updated Service object when successful.
 */
export async function updateService(
  input: UpdateServiceInput,
): Promise<Service | null> {
  // Find the service using BOTH its ID and its business ID.
  // This provides tenant isolation.
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
    // Return the updated document.
    { new: true },
  );

  // Nothing matched the service ID + business ID.
  if (!service) {
    return null;
  }

  // Return the updated service using the shared Service type.
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
 * Deactivates a service without deleting it from MongoDB.
 *
 * This is a soft-disable operation. The service remains in the
 * database so historical bookings and slots can still reference it.
 *
 * Returns the updated service, or null if it was not found.
 */
export async function deactivateService(
  businessId: string,
  serviceId: string,
): Promise<Service | null> {
  // Only deactivate the service if it belongs to this business.
  const service = await ServiceModel.findOneAndUpdate(
    {
      _id: serviceId,
      businessId,
    },
    {
      isActive: false,
    },
    // Return the updated document.
    { new: true },
  );

  // No matching service was found.
  if (!service) {
    return null;
  }

  // Return the deactivated service.
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
 * Gets one specific service by its ID.
 *
 * The businessId is also required so that a business can only
 * retrieve a service belonging to itself.
 *
 * Returns the service if found, otherwise null.
 */
export async function getServiceById(
  businessId: string,
  serviceId: string,
): Promise<Service | null> {
  // Search using both the service ID and business ID.
  const service = await ServiceModel.findOne({
    _id: serviceId,
    businessId,
  }).lean();

  // No matching service was found.
  if (!service) {
    return null;
  }

  // Return a clean Service object instead of the raw MongoDB document.
  return {
    id: String(service._id),
    businessId: service.businessId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    isActive: service.isActive,
  };
}