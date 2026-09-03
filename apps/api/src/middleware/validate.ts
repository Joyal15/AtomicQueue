import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validate(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Build a field name -> error message map; first issue per field wins.
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
        if (!(key in fields)) fields[key] = issue.message;
      }

      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          fields,
        },
      });
    }

    req.body = result.data;
    next();
  };
}