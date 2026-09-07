import pino from 'pino';

export const logger = pino({
  level: 'info',
  // pino-http logs the full request/response header set on every request.
  // Censor the ones that carry a credential — the `session` cookie value,
  // the `booking_access` magic-link token, any bearer token, and the
  // `Set-Cookie` on login/signup responses — so tokens never land in the
  // log stream (or downstream log aggregation) in plaintext.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});
