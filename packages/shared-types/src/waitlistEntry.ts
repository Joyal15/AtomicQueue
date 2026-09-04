export type WaitlistStatus = 'waiting' | 'notified' | 'expired' | 'converted';

export interface WaitlistCustomer {
  name: string;
  contact: string;
}

export interface WaitlistEntry {
  id: string;
  businessId: string;

  customer: WaitlistCustomer;

  desiredServiceId: string;
  desiredProviderId: string | null;

  status: WaitlistStatus;

  createdAt: string;
}
