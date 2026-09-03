export interface Resource {
  id: string;
  businessId: string;
  name: string;
  type: string;
  capacity: number;
  status: 'active' | 'removed';
}