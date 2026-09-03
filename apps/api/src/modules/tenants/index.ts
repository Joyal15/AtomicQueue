/**
 * Public surface of the Tenants module.
 *
 * Other modules — Peter 1's `auth` included — must import from this
 * barrel, never reach into `tenants.model.ts`/`staffInvitations.model.ts`
 * or the service files directly.
 */

export { default as tenantsRouter } from './tenants.routes.js';

export {
  createBusiness,
  getBusinessById,
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
