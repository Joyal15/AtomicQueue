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
      const sessionId = readSessionCookie(socket.handshake.headers.cookie);
      const user = await resolveAuthenticatedUser(sessionId);

      if (!user) {
        next(new Error('Unauthenticated'));
        return;
      }

      socket.data.businessId = user.businessId;
      socket.data.userId = user.userId;

      next();
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
 * DRAFT event contract — not yet agreed with the bookings module.
 * Two shapes for the two cases the UI needs (architecture doc's own
 * sketch): a plain status flip for a capacity-1 slot, or a recomputed
 * remaining count for a capacity-N resource where individual units
 * aren't shown. Expect this to change once bookings actually starts
 * calling it.
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
