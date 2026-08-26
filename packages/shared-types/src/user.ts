export type UserRole = 'owner' | 'staff' | 'customer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  businessId?: string;
}
