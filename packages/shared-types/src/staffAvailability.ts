export interface WeeklyAvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface StaffAvailability {
  id: string;
  businessId: string;
  staffUserId: string;
  weeklyWindows: WeeklyAvailabilityWindow[];
}
