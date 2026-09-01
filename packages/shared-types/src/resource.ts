// A non-person provider — a turf, a room, equipment (architecture doc Section 2).
// Plugs into ProviderAvailability/Slots via providerId + providerType: 'resource',
// the same shape a Users row uses for providerType: 'staff' — see providerAvailability.ts.

export type ResourceStatus = 'active' | 'removed';

export interface Resource {
  id: string;
  businessId: string;
  name: string;
  type: string; // free-text label, e.g. 'turf', 'room'
  capacity: number; // default 1 — interchangeable anonymous parallel units
  status: ResourceStatus;
}
