import { redis } from '../../lib/redis.js';
import { incrementWithTtl, peekCount } from '../../lib/rateLimit.js';
import { AppError } from '../../lib/Apperror.js';

/**
 * Login rate limiting (architecture doc §9): independent per-account and
 * per-IP Redis-backed limits.
 *
 *  - Per-account: 5 consecutive failures → locked out for 15 minutes,
 *    cleared only by that account's own successful login.
 *  - Per-IP: a more generous window catches credential-stuffing across
 *    many accounts from one source; decays only via its own TTL.
 *
 * The increment + TTL is a single atomic Redis operation
 * (`incrementWithTtl`'s Lua) — never check-then-increment. If Redis is
 * unreachable, every function here throws, and login fails closed with a
 * plain 500 rather than silently dropping the protection.
 */

const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_SECONDS = 15 * 60;
const ACCOUNT_KEY_PREFIX = 'auth:login:account:';

const IP_LIMIT = 50;
const IP_WINDOW_SECONDS = 15 * 60;
const IP_KEY_PREFIX = 'auth:login:ip:';

function getAccountKey(email: string): string {
  return `${ACCOUNT_KEY_PREFIX}${email}`;
}

function getIpKey(ipAddress: string): string {
  return `${IP_KEY_PREFIX}${ipAddress}`;
}

/**
 * Pre-flight lockout check, run BEFORE any password comparison. Once an
 * account (or IP) has reached its failure limit within the window, every
 * further attempt is rejected — including one carrying the correct
 * password, so an attacker can't "unlock" the account by finally
 * guessing right inside the window. Reset happens only via
 * `resetLoginFailures` on a genuine success, or the key's own TTL.
 *
 * A Redis failure here propagates so `login` fails closed (500).
 */
export async function assertLoginNotLocked(
  email: string,
  ipAddress: string,
): Promise<void> {
  const [accountCount, ipCount] = await Promise.all([
    peekCount(getAccountKey(email)),
    peekCount(getIpKey(ipAddress)),
  ]);

  if (accountCount >= ACCOUNT_LIMIT || ipCount >= IP_LIMIT) {
    throw new AppError(
      429,
      'LOGIN_RATE_LIMITED',
      'Too many login attempts. Please try again later.',
      ACCOUNT_WINDOW_SECONDS,
    );
  }
}

export async function recordLoginFailure(email: string): Promise<boolean> {
  const count = await incrementWithTtl(
    getAccountKey(email),
    ACCOUNT_WINDOW_SECONDS,
  );

  return count <= ACCOUNT_LIMIT;
}

export async function resetLoginFailures(email: string): Promise<void> {
  await redis.del(getAccountKey(email));
}

export async function recordIpLoginFailure(
  ipAddress: string,
): Promise<boolean> {
  const count = await incrementWithTtl(getIpKey(ipAddress), IP_WINDOW_SECONDS);

  return count <= IP_LIMIT;
}

export async function resetIpLoginFailures(
  ipAddress: string,
): Promise<void> {
  await redis.del(getIpKey(ipAddress));
}
