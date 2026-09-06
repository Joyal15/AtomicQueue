/**
 * Public surface of the Tenants module.
 *
 * Other modules must import from this barrel, not the model or service
 * files directly.
 */

export { default as tenantsRouter } from './tenants.routes.js';

// Public (unauthenticated) business-by-slug lookup — owns its own
// top-level path (`/businesses/:slug`), not nested under the
// authenticated mount above. See publicBusiness.routes.ts.
export { default as publicBusinessRouter } from './publicBusiness.routes.js';

export {
  createBusiness,
  getBusinessById,
  getBusinessBySlug,
  listBusinessIds,
  updateBusiness,
  type CreateBusinessInput,
  type UpdateBusinessInput,
} from './tenants.service.js';

export {
  createStaffInvitation,
  getStaffInvitations,
  revokeStaffInvitation,
  consumeInvitation,
  type CreateStaffInvitationInput,
  type CreatedStaffInvitation,
  type RevokeStaffInvitationError,
  type RevokeStaffInvitationResult,
  type ConsumedInvitation,
} from './staffInvitations.service.js';

export {
  listStaffMembers,
  removeStaffMember,
  reactivateStaffMember,
  type StaffMember,
} from './staff.service.js';
