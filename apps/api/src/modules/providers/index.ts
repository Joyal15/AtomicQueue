/**
 * Public surface of the Providers module.
 *
 * "Provider" is a domain concept, not a collection — a staff
 * provider is a `Users` row, a resource provider is a `Resources`
 * row. This module owns two things over that polymorphic reference:
 *
 *   - `validateProvider` — the single write-path guard every path
 *     that sets a `providerId`/`providerType` pair must call
 *     (architecture doc Section 2b), never re-checked inline.
 *   - `listProviders` — the unified read the dashboard and the
 *     availability provider picker use.
 *
 * Deliberately NOT exported: the underlying `UserModel` /
 * `ResourceModel`. Callers get a `ValidatedProvider` / `Provider`
 * back, never a raw document.
 */

export {
  validateProvider,
  isProviderEligibleRole,
  listProviders,
  type ProviderEligibleRole,
  type ValidatedProvider,
  type ProviderValidationResult,
  type ProviderValidationSuccess,
  type ProviderValidationFailure,
  type ListProvidersOptions,
} from './providers.service.js';

export type { Provider, ProviderStatus } from './providers.model.js';

// HTTP router, mounted under `/api/providers` by the routes barrel.
export { default as providersRouter } from './providers.routes.js';
