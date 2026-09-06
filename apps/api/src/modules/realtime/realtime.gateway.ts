/**
 * Socket.IO gateway.
 *
 * Every client joins a tenant-scoped room, `business:${businessId}`.
 * The businessId always comes from resolving the session cookie
 * server-side — never from anything the client sends — so one
 * business's connected clients can never join another business's
 * room by claiming to.
 *
 * That resolution runs in the handshake middleware below, which
 * Socket.IO re-runs on every connection attempt, including a
 * reconnect after a dropped connection — so room membership is
 * always derived from whatever session is current, never cached
 * from an earlier connection.
 */

import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

import type { ProviderType, SlotStatus } from '@queueless/shared-types';

import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { resolveAuthenticatedUser } from '../auth/index.js';
// Concrete file, not the tenants barrel, to keep this import off the
// tenants -> staff -> slots -> realtime module cycle.
import { getBusinessBySlug } from '../tenants/tenants.service.js';

const SESSION_COOKIE_NAME = 'session';
const SLOT_UPDATED_EVENT = 'slot:updated';

let io: Server | null = null;

/** Pulls the session cookie's value out of a raw `Cookie` header. */
function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;

    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }

  return undefined;
}

/**
 * Starts the Socket.IO server on top of the app's existing HTTP
 * server. Call once, before the HTTP server starts listening.
 */
export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
  });

  io.use(async (socket: Socket, next) => {
    try {
      // Staff/owner: identity + room from the session cookie, resolved
      // server-side (§9). Never trust a client-supplied businessId.
      const sessionId = readSessionCookie(socket.handshake.headers.cookie);
      const user = await resolveAuthenticatedUser(sessionId);

      if (user) {
        socket.data.businessId = user.businessId;
        socket.data.userId = user.userId;
        next();
        return;
      }

      // Anonymous customer on a public booking page: no session, so the
      // room is resolved from the business's PUBLIC slug — the same
      // slug already in the page URL and used by every public REST
      // endpoint. The slug is resolved to a businessId server-side here;
      // the client never names a room or businessId directly (§7/§9),
      // and `slot:updated` payloads carry no non-public fields (§13).
      const slug = socket.handshake.auth?.slug;
      if (typeof slug === 'string' && slug.length > 0) {
        const business = await getBusinessBySlug(slug);
        if (business) {
          socket.data.businessId = business.id;
          next();
          return;
        }
      }

      next(new Error('Unauthenticated'));
    } catch (error) {
      next(error instanceof Error ? error : new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const room = `business:${socket.data.businessId}`;
    socket.join(room);
  });

  logger.info('Realtime gateway started');

  return io;
}

/**
 * Locked event contract (agreed with the bookings module). Two shapes
 * for the two cases the UI needs (architecture doc §4b): `{ slotId,
 * status }` for a slot-specific status change (a hold forming/
 * releasing, a manual block) — the staff dashboard patches that one
 * row by id. `{ providerId, providerType, datetime, remaining }` for
 * an action that permanently consumes a unit of public availability
 * (a walk-in or booking confirm) — the customer browsing page only
 * ever sees aggregate buckets, never an individual slotId, so it
 * needs the bucket's updated count instead.
 */
export type SlotUpdatePayload =
  | {
      slotId: string;
      status: SlotStatus;
    }
  | {
      providerId: string;
      providerType: ProviderType;
      datetime: string;
      remaining: number;
    };

/**
 * Pushes a slot-update event to everyone connected for one business.
 * Best-effort: if the gateway hasn't started yet, this just logs and
 * does nothing — never throws, since a missed realtime push is never
 * allowed to break the caller's actual write.
 */
export function emitSlotUpdate(
  businessId: string,
  payload: SlotUpdatePayload,
): void {
  if (!io) {
    logger.warn('emitSlotUpdate called before the realtime gateway started');
    return;
  }

  io.to(`business:${businessId}`).emit(SLOT_UPDATED_EVENT, payload);
}
