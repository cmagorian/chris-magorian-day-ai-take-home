import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors';

// Turns thrown/forwarded errors into the stable { code, message } envelope. The 4-arg
// signature is how Express recognizes error middleware, so `_next` has to stay.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ code: 'VALIDATION_ERROR', message: 'invalid request body', issues: err.issues });
    return;
  }

  // express.json() throws a SyntaxError (status 400) on a malformed body. Without this it
  // would fall through to the 500 branch — a client mistake reported as a server fault.
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'invalid JSON' });
    return;
  }

  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({ code: err.code, message: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : 'unexpected error';
  res.status(500).json({ code: 'INTERNAL_ERROR', message });
}
