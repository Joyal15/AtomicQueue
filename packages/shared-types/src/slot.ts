import type { ProviderType } from './providerAvailability.js';

// 'held' and 'confirmed' are set by the future hold/claim flow (bookings
// module), never by generate-weekly-slots — that job only ever inserts
// 'available'. 'completed'/'no-show' are NOT Slot states; they live on
// Booking only (architecture doc Section 2/3).
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
  /**
   * Snapshotted from Service.durationMinutes ONCE at generation time —
   * never re-read live, and never resized by a later Service edit
   * (architecture doc Section 2).
   */
  durationMinutes: number;
  /** 0 for a staff provider; 0..capacity-1 for a resource's parallel units. */
  unitIndex: number;
  status: SlotStatus;
}
