/**
 * Public surface of the no-show scoring module (architecture doc §10).
 *
 * `enqueueNoShowScoring` is called post-commit by the `bookings` module;
 * `runNoShowScoringJob` is dispatched by `worker.ts`. Nothing else in
 * this module is exported — it holds no HTTP routes and owns no model
 * (every `Booking` read/write goes through the `bookings` module's
 * exported functions).
 */
export {
  enqueueNoShowScoring,
  runNoShowScoringJob,
  SCORE_NO_SHOW_RISK_JOB,
} from './noshow.service.js';
