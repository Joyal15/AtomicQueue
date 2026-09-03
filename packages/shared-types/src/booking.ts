export type BookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

export type ContactType = 'email' | 'phone';

export interface BookingCustomer {
  name: string;
  contactType: ContactType;
  contact: string;
}

export interface Booking {
  id: string;
  businessId: string;
  slotId: string;

  customer: BookingCustomer;

  createdBy: string | null;

  status: BookingStatus;

  accessTokenExpiresAt: string | null;

  noShowRiskNote: string | null;

  createdAt: string;
  cancelledAt: string | null;
}