export {
  joinWaitlist,
  listWaitlist,
  findNextMatchingWaitlistEntry,
  markWaitlistEntryNotified,
  notifyNextWaitlistEntry,
  type JoinWaitlistInput,
  type WaitlistEntryItem,
} from './waitlist.service.js';

export type { WaitlistStatus } from './waitlist.model.js';

// HTTP router, mounted under `/api/waitlist` by the top-level routes barrel.
export { default as waitlistRouter } from './waitlist.routes.js';
