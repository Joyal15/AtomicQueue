import type { ProviderType } from './providerAvailability.js';

// Newly generated slots start as 'available'; 'held'/'confirmed' are set by the
// booking flow. 'completed'/'no-show' live on Booking, not here.
export type SlotStatus =
  | 'available'
  | 'held'
  | 'confirmed'
  | 'cancelled'
  | 'blocked';

export interface Slot {
  id: string;
  businessId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  /** UTC instant, ISO 8601. */
  datetime: string;
  /** Snapshotted from the Service at generation time; not updated later. */
  durationMinutes: number;
  /** 0 for a staff provider; 0..capacity-1 for a resource's parallel units. */
  unitIndex: number;
  status: SlotStatus;
}
