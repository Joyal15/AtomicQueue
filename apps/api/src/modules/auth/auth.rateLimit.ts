import { redis } from '../../lib/redis.js';

const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_SECONDS = 15 * 60;

const ACCOUNT_KEY_PREFIX = 'auth:login:account:';

const IP_LIMIT = 20;
const IP_WINDOW_SECONDS = 15 * 60;

const IP_KEY_PREFIX = 'auth:login:ip:';

function getAccountKey(email: string): string {
  return `${ACCOUNT_KEY_PREFIX}${email}`;
}

function getIpKey(ipAddress: string): string {
  return `${IP_KEY_PREFIX}${ipAddress}`;
}

export async function recordLoginFailure(
  email: string,
): Promise<boolean> {
  const key = getAccountKey(email);

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, ACCOUNT_WINDOW_SECONDS);
  }

  return count <= ACCOUNT_LIMIT;
}

export async function resetLoginFailures(
  email: string,
): Promise<void> {
  await redis.del(getAccountKey(email));
}

export async function recordIpLoginFailure(
  ipAddress: string,
): Promise<boolean> {
  const key = getIpKey(ipAddress);

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, IP_WINDOW_SECONDS);
  }

  return count <= IP_LIMIT;
}

export async function resetIpLoginFailures(
  ipAddress: string,
): Promise<void> {
  await redis.del(getIpKey(ipAddress));
}