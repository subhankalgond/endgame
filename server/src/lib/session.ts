import { randomBytes, createHash } from 'node:crypto';
import type { Response } from 'express';
import { config } from '../config';
import { db } from '../db';

const ADMIN_COOKIE = 'eg_admin';
const PARTICIPANT_COOKIE = 'eg_session';

export type SessionRole = 'admin' | 'participant';

export interface SessionRow {
  token_hash: string;
  role: SessionRole;
  participant_id: string | null;
  admin_id: number | null;
  expires_at: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function setCookie(res: Response, name: string, token: string): void {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
}

export function hashToken(token: string): string {
  return sha256(token);
}

export async function createSession(
  res: Response,
  role: SessionRole,
  refs: { participantId?: string; adminId?: number },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.prepare(
    `INSERT INTO sessions (token_hash, role, participant_id, admin_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), role, refs.participantId ?? null, refs.adminId ?? null, now, now + config.sessionTtlHours * 3600 * 1000);
  setCookie(res, role === 'admin' ? ADMIN_COOKIE : PARTICIPANT_COOKIE, token);
  return token;
}

export function readSessionToken(req: { cookies?: unknown }, role: SessionRole): string | null {
  const bag = req.cookies as Record<string, unknown> | undefined;
  const name = role === 'admin' ? ADMIN_COOKIE : PARTICIPANT_COOKIE;
  const raw = bag?.[name];
  if (typeof raw === 'string' && raw.length > 10) return raw;
  return null;
}

export async function lookupSession(role: SessionRole, token: string | null): Promise<SessionRow | null> {
  if (!token) return null;
  const row = await db
    .prepare(`SELECT * FROM sessions WHERE token_hash = ? AND role = ?`)
    .get(sha256(token), role) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
    return null;
  }
  return row;
}

export async function destroySession(role: SessionRole, token: string | null): Promise<void> {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
}

export function clearSessionCookies(res: Response): void {
  const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.isProduction };
  res.clearCookie(ADMIN_COOKIE, opts);
  res.clearCookie(PARTICIPANT_COOKIE, opts);
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(Date.now());
}
