/**
 * Public surface of the Providers module.
 *
 * "Provider" is a domain concept, not a collection — a staff provider is
 * a `Users` row, a resource provider is a `Resources` row. This module
 * owns:
 *
 *   - `validateProvider` — the single guard every write path that sets a
 *     `providerId`/`providerType` pair must call.
 *   - `listProviders` — the unified read the dashboard and availability
 *     provider picker use.
 *
 * Not exported: `UserModel` / `ResourceModel`. Callers only get back a
 * `ValidatedProvider` / `Provider`.
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
