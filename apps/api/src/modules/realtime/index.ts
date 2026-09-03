/**
 * Public surface of the Realtime module. Other modules import from
 * here, not from `realtime.gateway.ts` directly.
 */

export {
  initRealtime,
  emitSlotUpdate,
  type SlotUpdatePayload,
} from './realtime.gateway.js';
