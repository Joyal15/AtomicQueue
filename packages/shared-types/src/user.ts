// Customers are not a role — they don't have a User record at all; they're identified
// separately and authenticate via magic link instead of a session.
export type UserRole = 'owner' | 'staff';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  businessId: string; // the business this user belongs to
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  businessId: string;
}
