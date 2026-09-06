#!/usr/bin/env node
/**
 * QueueLess++ double-booking concurrency demo (PROJECT_PLAN.md Phase 5).
 *
 * Fires N simultaneous anonymous hold requests at a single slot bucket
 * and asserts the atomic conditional write let exactly the bucket's
 * capacity through — the rest get 409 SLOT_NOT_AVAILABLE.
 *
 * Usage:
 *   node scripts/concurrency-demo.mjs [baseUrl] [racers]
 *   node scripts/concurrency-demo.mjs                       # http://localhost:4000, 8 racers
 *   node scripts/concurrency-demo.mjs https://my-deploy 12
 *
 * No dependencies — just Node's global fetch (Node >= 20).
 */

const BASE = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const RACERS = Number(process.argv[3] || 8);

const rnd = () => Math.random().toString(36).slice(2, 10);
const isoInDays = (d, h = 12) => {
  const x = new Date(Date.now() + d * 86400000);
  x.setUTCHours(h, 0, 0, 0);
  return x.toISOString();
};

function jar() {
  const cookies = {};
  return {
    async f(path, opts = {}) {
      const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
      const ck = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      if (ck) headers.cookie = ck;
      const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const m = /^([^=]+)=([^;]*)/.exec(line);
        if (m) cookies[m[1]] = m[2];
      }
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    },
  };
}

let failures = 0;
function expect(cond, label, detail) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures += 1;
}

async function setupBusiness() {
  const owner = jar();
  const email = `demo_${rnd()}@example.com`;
  let r = await owner.f('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Demo Owner',
      email,
      password: 'password123',
      businessName: `Concurrency Demo ${rnd()}`,
    }),
  });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  const { slug, id: businessId, ownerId } = {
    slug: r.body.data.business.slug,
    id: r.body.data.business.id,
    ownerId: r.body.data.user.id,
  };

  r = await owner.f('/api/services', {
    method: 'POST',
    body: JSON.stringify({ name: 'Demo Service', durationMinutes: 60, price: 0 }),
  });
  const serviceId = r.body.data.id;

  // owner acts as a capacity-1 staff provider
  const everyDay = Array.from({ length: 7 }, (_, d) => ({
    dayOfWeek: d, startTime: '00:00', endTime: '23:00',
  }));
  await owner.f('/api/availability', {
    method: 'POST',
    body: JSON.stringify({ providerId: ownerId, providerType: 'staff', serviceId, weeklyWindows: everyDay }),
  });

  // a capacity-2 resource provider
  r = await owner.f('/api/resources', {
    method: 'POST',
    body: JSON.stringify({ name: 'Demo Room', type: 'room', capacity: 2 }),
  });
  const resourceId = r.body.data.id;
  await owner.f('/api/availability', {
    method: 'POST',
    body: JSON.stringify({ providerId: resourceId, providerType: 'resource', serviceId, weeklyWindows: everyDay }),
  });

  await owner.f('/api/slots/generate', { method: 'POST', body: JSON.stringify({ days: 3 }) });

  return { slug, businessId, serviceId };
}

async function race({ slug, serviceId }, providerType, expectedWinners) {
  const anon = jar();
  const r = await anon.f(
    `/api/businesses/${slug}/availability?serviceId=${serviceId}&providerType=${providerType}`,
  );
  const buckets = r.body.data || [];
  const bucket = buckets.find(
    (b) => b.remaining === b.total &&
      b.total === expectedWinners &&
      new Date(b.datetime).getTime() > Date.now() + 86400000,
  );
  if (!bucket) {
    expect(false, `${providerType}: found a capacity-${expectedWinners} bucket`, buckets.slice(0, 2));
    return;
  }

  const holds = Array.from({ length: RACERS }, () =>
    anon.f('/api/bookings/hold', {
      method: 'POST',
      body: JSON.stringify({
        slug,
        providerId: bucket.providerId,
        providerType,
        serviceId,
        datetime: bucket.datetime,
        sessionId: `demo_${rnd()}${rnd()}`,
      }),
    }),
  );
  const results = await Promise.all(holds);
  const wins = results.filter((x) => x.status === 201).length;
  const losses = results.filter((x) => x.status === 409).length;
  const other = results.filter((x) => x.status !== 201 && x.status !== 409).map((x) => x.status);

  expect(
    wins === expectedWinners && losses === RACERS - expectedWinners && other.length === 0,
    `${providerType} capacity-${expectedWinners}: ${RACERS} racers → ${wins} win / ${losses} × 409`,
    other.length ? { unexpectedStatuses: other } : undefined,
  );
}

(async () => {
  console.log(`\nQueueLess++ concurrency demo → ${BASE}  (${RACERS} racers)\n`);
  const ctx = await setupBusiness();
  await race(ctx, 'staff', 1);
  await race(ctx, 'resource', 2);
  console.log(`\n${failures === 0 ? 'PASS — no double-booking' : `FAIL — ${failures} assertion(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('demo error:', err);
  process.exit(2);
});
