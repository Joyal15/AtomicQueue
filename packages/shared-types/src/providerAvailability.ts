// Generation template for both staff and resource providers — NOT staff-only.
// See architecture doc Section 2/2a: "Provider" = whoever/whatever a Slot is generated
// for, and a ProviderAvailability row references either a Users row (providerType:
// 'staff') or a Resources row (providerType: 'resource') through the same shape, so
// the booking/generation engine never forks per provider kind.

export interface WeeklyAvailabilityWindow {
  dayOfWeek: number;
  startTime: string; // business-local wall-clock time (Business.timezone), not UTC
  endTime: string;
}

export type ProviderType = 'staff' | 'resource';

export interface ProviderAvailability {
  id: string;
  businessId: string;
  providerId: string; // ref -> Users (if providerType 'staff') or Resources (if 'resource')
  providerType: ProviderType;
  serviceId: string; // required — see architecture doc Section 2's "Multi-service providers" note
  weeklyWindows: WeeklyAvailabilityWindow[];
}
