import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { db } from './db';
import type { ParticipantRow } from './game';
import { HttpError, httpError } from './lib/http';
import { lookupSession, readSessionToken } from './lib/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      participant?: ParticipantRow;
      adminId?: number;
    }
  }
}

/** Resolve the participant session (if any) without failing the request. */
export function attachParticipant(req: Request, _res: Response, next: NextFunction): void {
  const token = readSessionToken(req, 'participant');
  const session = lookupSession('participant', token);
  if (session?.participant_id) {
    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(session.participant_id) as
      | ParticipantRow
      | undefined;
    if (row) {
      req.participant = row;
      db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id);
    }
  }
  next();
}

/** Reject the request unless a valid participant session exists. */
export function requireParticipant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.participant) {
    next(httpError(401, 'Session not found. Please rejoin with your team QR code.', 'no_session'));
    return;
  }
  next();
}

/** Reject the request unless a valid administrator session exists. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const token = readSessionToken(req, 'admin');
  const session = lookupSession('admin', token);
  if (!session || !session.admin_id) {
    next(httpError(401, 'Administrator authentication required.', 'unauthenticated'));
    return;
  }
  req.adminId = session.admin_id;
  next();
}

/** Validate request bodies with zod; failures become safe 400 responses. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw httpError(400, 'Invalid request.', 'validation');
  }
  return result.data as z.infer<S>;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.', code: 'not_found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(400).json({ error: 'Invalid request.', code: 'bad_json' });
    return;
  }
  // body-parser failures (payload too large, charset issues) stay client errors
  const known = err as { status?: number; type?: string } | null;
  if (known && typeof known.status === 'number' && known.status >= 400 && known.status < 500) {
    res
      .status(known.status)
      .json({ error: known.type === 'entity.too.large' ? 'Request too large.' : 'Invalid request.', code: known.type ?? 'bad_request' });
    return;
  }
  console.error('[endgame] unhandled error:', err);
  res.status(500).json({ error: 'Unable to process the request.', code: 'internal' });
}
