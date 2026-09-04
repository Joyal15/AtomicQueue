/**
 * Public surface of the Tenants module.
 *
 * Other modules must import from this barrel, not the model or service
 * files directly.
 */

export { default as tenantsRouter } from './tenants.routes.js';

export {
  createBusiness,
  getBusinessById,
  getBusinessBySlug,
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
