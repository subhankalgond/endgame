import { db, nowMs } from './db';

/**
 * Keep the team_tokens table (the four reward tokens a team can earn) in sync
 * with the puzzle configuration. Written in the same request as any token edit.
 */
export async function syncTeamToken(teamId: number, slot: number, token: string): Promise<void> {
  await db.prepare(
    `INSERT INTO team_tokens (team_id, slot, reward_token, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id, slot) DO UPDATE SET reward_token = excluded.reward_token, updated_at = excluded.updated_at`,
  ).run(teamId, slot, token, nowMs());
}

/**
 * Rotate a team's QR join token. The previous token is revoked immediately so
 * an already-printed QR stops resolving, and every issued token is kept for audit.
 */
export async function recordJoinToken(
  teamId: number,
  token: string,
  opts: { revokePrevious?: boolean } = {},
): Promise<void> {
  const now = nowMs();
  if (opts.revokePrevious !== false) {
    await db.prepare('UPDATE team_join_tokens SET active = 0, revoked_at = ? WHERE team_id = ? AND active = 1').run(
      now,
      teamId,
    );
  }
  await db.prepare(
    `INSERT INTO team_join_tokens (token, team_id, active, created_at, revoked_at)
     VALUES (?, ?, 1, ?, NULL)
     ON CONFLICT(token) DO UPDATE SET active = 1, revoked_at = NULL`,
  ).run(token, teamId, now);
}
