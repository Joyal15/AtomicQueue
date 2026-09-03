// Availability template for a provider, which can be a staff member or a resource.

export interface WeeklyAvailabilityWindow {
  dayOfWeek: number;
  startTime: string; // business-local wall-clock time, not UTC
  endTime: string;
}

export type ProviderType = 'staff' | 'resource';

export interface ProviderAvailability {
  id: string;
  businessId: string;
  providerId: string; // references a User (staff) or Resource (resource)
  providerType: ProviderType;
  serviceId: string;
  weeklyWindows: WeeklyAvailabilityWindow[];
}
