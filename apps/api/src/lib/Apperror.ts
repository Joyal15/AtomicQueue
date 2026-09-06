export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /**
     * Seconds the caller should wait before retrying. Set on 429s so
     * `errorHandler` can emit a `Retry-After` header (architecture doc
     * §13's rate-limiting contract). Omitted for every other status.
     */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
