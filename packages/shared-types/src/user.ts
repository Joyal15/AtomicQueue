// 'customer' is NOT a role — customers never have a Users document at all (architecture
// doc Section 2/9); they're identified separately by businessId + contactType +
// normalizedContact and authenticate via magic link, never a session.
export type UserRole = 'owner' | 'staff';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  businessId: string; // every Users row belongs to exactly one business — no "null for
                       // customers" case, since customers never get a row here
}
