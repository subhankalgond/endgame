import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit, db, nowMs } from '../db';
import {
  computeRankings,
  endRound,
  getResults,
  getRound,
  liveStatus,
  prepareRound,
  refreshRound,
  resetRound,
  startRound,
} from '../game';
import { ah, httpError } from '../lib/http';
import { requestOrigin } from '../lib/origin';
import { renderQr } from '../qr';
import { recordJoinToken, syncTeamToken } from '../tokens';
import { parseBody, requireAdmin } from '../middleware';
import { config } from '../config';
import { verifyPassword } from '../lib/password';
import { createSession, destroySession, readSessionToken } from '../lib/session';
import { newJoinToken } from '../seed';
import { roundView } from '../payloads';

export const adminRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 15 * config.rateLimitFactor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a moment.', code: 'rate_limited' },
});

const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300 * config.rateLimitFactor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});

adminRouter.use('/login', loginLimiter);

/* ------------------------------------------------------------------ auth */

const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });

adminRouter.post(
  '/login',
  ah(async (req, res) => {
    const { username, password } = parseBody(loginSchema, req.body);
    const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string }
      | undefined;
    const valid = admin ? verifyPassword(password, admin.password_hash) : false;
    if (!admin || !valid) {
      audit('admin_login_failed', 'admin', { detail: { username } });
      throw httpError(401, 'Invalid credentials.', 'bad_credentials');
    }
    const prior = readSessionToken(req, 'admin');
    if (prior) await destroySession('admin', prior);
    await createSession(res, 'admin', { adminId: admin.id });
    audit('admin_login', 'admin', { actorId: admin.id, detail: { username: admin.username } });
    res.json({ ok: true, username: admin.username });
  }),
);

adminRouter.post(
  '/logout',
  ah(async (req, res) => {
    await destroySession('admin', readSessionToken(req, 'admin'));
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/me',
  requireAdmin,
  ah(async (req, res) => {
    const admin = await db.prepare('SELECT id, username FROM admins WHERE id = ?').get(req.adminId!) as
      | { id: number; username: string }
      | undefined;
    if (!admin) throw httpError(401, 'Administrator authentication required.', 'unauthenticated');
    res.json(admin);
  }),
);

adminRouter.use(requireAdmin, adminLimiter);

/* ----------------------------------------------------------------- teams */

const teamUpdateSchema = z.object({
  name: z.string().min(2).max(32).optional(),
  roster: z.array(z.string().max(24)).length(4).optional(),
});

adminRouter.get(
  '/teams',
  ah(async (req, res) => {
    const teams = await db.prepare('SELECT * FROM teams ORDER BY id').all() as {
      id: number;
      name: string;
      join_token: string;
      correct_sequence: string;
      roster: string | null;
    }[];
    res.json({
      teams: await Promise.all(
        teams.map(async (team) => {
        const players = await db
          .prepare('SELECT slot, name, is_leader, solved_at FROM participants WHERE team_id = ? ORDER BY slot')
          .all(team.id) as { slot: number; name: string; is_leader: number; solved_at: number | null }[];
        return {
          id: team.id,
          name: team.name,
          joinToken: team.join_token,
          joinUrl: joinUrl(req, team.join_token),
          correctSequence: JSON.parse(team.correct_sequence) as string[],
          roster: parseRoster(team.roster),
          players: players.map((p) => ({
            slot: p.slot,
            name: p.name,
            isLeader: p.is_leader === 1,
            solved: p.solved_at != null,
          })),
        };
        }),
      ),
    });
  }),
);

function parseRoster(value: string | null): string[] {
  if (!value) return ['', '', '', ''];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.length === 4) return parsed.map((v) => (typeof v === 'string' ? v : ''));
  } catch {
    /* ignore */
  }
  return ['', '', '', ''];
}

/**
 * Join URLs power the QR codes. Uses the pinned PUBLIC_BASE_URL when set,
 * otherwise the origin of the current request (any host, behind any proxy) so
 * a QR printed from a deployed instance always opens the live site.
 */
function joinUrl(req: Request, token: string): string {
  const base = (config.publicBaseUrl || requestOrigin(req)).replace(/\/$/, '');
  return `${base}/join/team/${token}`;
}

adminRouter.put(
  '/teams/:id',
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId) || teamId < 1 || teamId > 8) throw httpError(400, 'Invalid team.', 'invalid_team');
    const body = parseBody(teamUpdateSchema, req.body);
    const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as { id: number; name: string } | undefined;
    if (!team) throw httpError(404, 'Team not found.', 'not_found');

    if (body.name) {
      try {
        await db.prepare('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?').run(body.name, nowMs(), teamId);
      } catch {
        throw httpError(409, 'That team name is already in use.', 'duplicate_name');
      }
    }

    if (body.roster) {
      await db.prepare('UPDATE teams SET roster = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(body.roster.map((n) => n.trim())),
        nowMs(),
        teamId,
      );
      const joined = await db.prepare('SELECT slot, name FROM participants WHERE team_id = ?').all(teamId) as {
        slot: number;
        name: string;
      }[];
      for (const player of joined) {
        const desired = body.roster[player.slot - 1]?.trim();
        if (desired && desired.toLowerCase() !== player.name.toLowerCase()) {
          const taken = await db
            .prepare('SELECT id FROM participants WHERE team_id = ? AND slot != ? AND LOWER(name) = LOWER(?)')
            .get(teamId, player.slot, desired);
          if (taken) throw httpError(409, 'A player with that name is already on this team.', 'duplicate_name');
          await db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(
            desired,
            (await db.prepare('SELECT id FROM participants WHERE team_id = ? AND slot = ?').get(teamId, player.slot) as {
              id: string;
            }).id,
          );
        }
      }
    }

    audit('admin_team_updated', 'admin', { actorId: req.adminId, teamId, detail: { name: body.name ?? null } });
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------- QR */

adminRouter.get(
  '/qr',
  ah(async (req, res) => {
    const teams = await db.prepare('SELECT id, name, join_token FROM teams ORDER BY id').all() as {
      id: number;
      name: string;
      join_token: string;
    }[];
    const items = await Promise.all(
      teams.map(async (team) => ({
        id: team.id,
        name: team.name,
        joinUrl: joinUrl(req, team.join_token),
        qr: await renderQr(joinUrl(req, team.join_token)),
      })),
    );
    res.json({ items });
  }),
);

const regenerateSchema = z.object({ teamId: z.number().int().min(1).max(8) });

adminRouter.post(
  '/qr/regenerate',
  ah(async (req, res) => {
    const { teamId } = parseBody(regenerateSchema, req.body);
    const token = newJoinToken();
    await db.prepare('UPDATE teams SET join_token = ?, updated_at = ? WHERE id = ?').run(token, nowMs(), teamId);
    await recordJoinToken(teamId, token);
    audit('qr_regenerated', 'admin', { actorId: req.adminId, teamId, detail: { invalidated: 'previous token' } });
    res.json({ teamId, joinUrl: joinUrl(req, token) });
  }),
);

/* --------------------------------------------------------------- puzzles */

const puzzleUpdateSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(200),
  altAnswers: z.array(z.string().max(200)).max(10).default([]),
  rewardToken: z.string().min(1).max(16),
  difficulty: z.enum(['easy', 'medium-easy', 'medium']),
  explanation: z.string().max(500).default(''),
});

adminRouter.get(
  '/puzzles',
  ah(async (_req, res) => {
    const rows = await db
      .prepare(
        `SELECT p.*, t.name AS team_name FROM puzzles p JOIN teams t ON t.id = p.team_id ORDER BY p.team_id, p.slot`,
      )
      .all() as {
      id: number;
      team_id: number;
      slot: number;
      question: string;
      answer: string;
      alt_answers: string;
      reward_token: string;
      difficulty: string;
      explanation: string;
      team_name: string;
    }[];
    res.json({
      puzzles: rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name,
        slot: row.slot,
        question: row.question,
        answer: row.answer,
        altAnswers: JSON.parse(row.alt_answers) as string[],
        rewardToken: row.reward_token,
        difficulty: row.difficulty,
        explanation: row.explanation,
      })),
    });
  }),
);

adminRouter.put(
  '/puzzles/:id',
  ah(async (req, res) => {
    const puzzleId = Number(req.params.id);
    if (!Number.isInteger(puzzleId) || puzzleId < 1) throw httpError(400, 'Invalid puzzle.', 'invalid_puzzle');
    const body = parseBody(puzzleUpdateSchema, req.body);
    const existing = await db.prepare('SELECT * FROM puzzles WHERE id = ?').get(puzzleId) as
      | { id: number; team_id: number; slot: number }
      | undefined;
    if (!existing) throw httpError(404, 'Puzzle not found.', 'not_found');
    await db.prepare(
      `UPDATE puzzles SET question = ?, answer = ?, alt_answers = ?, reward_token = ?, difficulty = ?, explanation = ?, updated_at = ? WHERE id = ?`,
    ).run(
      body.question.trim(),
      body.answer.trim(),
      JSON.stringify(body.altAnswers.map((a) => a.trim()).filter(Boolean)),
      body.rewardToken.trim(),
      body.difficulty,
      body.explanation.trim(),
      nowMs(),
      puzzleId,
    );
    await syncTeamToken(existing.team_id, existing.slot, body.rewardToken.trim());
    audit('puzzle_updated', 'admin', { actorId: req.adminId, detail: { puzzleId } });
    res.json({ ok: true });
  }),
);

const sequenceSchema = z.object({ sequence: z.array(z.string().min(1).max(16)).length(4) });

adminRouter.put(
  '/teams/:id/sequence',
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    if (!Number.isInteger(teamId) || teamId < 1 || teamId > 8) throw httpError(400, 'Invalid team.', 'invalid_team');
    const { sequence } = parseBody(sequenceSchema, req.body);
    const tokens = (
      await db.prepare('SELECT reward_token FROM puzzles WHERE team_id = ? ORDER BY slot').all(teamId) as {
        reward_token: string;
      }[]
    ).map((row) => row.reward_token);
    const unique = new Set(sequence);
    if (unique.size !== 4 || sequence.some((t) => !tokens.includes(t))) {
      throw httpError(400, 'Sequence must be the team’s four reward tokens in some order.', 'invalid_sequence');
    }
    await db.prepare('UPDATE teams SET correct_sequence = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(sequence),
      nowMs(),
      teamId,
    );
    audit('correct_sequence_updated', 'admin', { actorId: req.adminId, teamId });
    res.json({ ok: true });
  }),
);

/* ---------------------------------------------------------- round control */

adminRouter.get(
  '/round',
  ah(async (_req, res) => {
    const round = await refreshRound();
    const status = await liveStatus();
    const readyTeams = status.readyTeams;
    res.json({
      round: roundView(round),
      readyTeams,
      participants: status.participants,
      expected: { participants: 32, teams: 8 },
    });
  }),
);

adminRouter.post(
  '/round/prepare',
  ah(async (req, res) => {
    res.json({ round: roundView(await prepareRound(req.adminId!)) });
  }),
);

adminRouter.post(
  '/round/start',
  ah(async (req, res) => {
    res.json({ round: roundView(await startRound(req.adminId!)) });
  }),
);

adminRouter.post(
  '/round/end',
  ah(async (req, res) => {
    res.json({ round: roundView(await endRound('admin', req.adminId!)), results: await getResults() });
  }),
);

const resetSchema = z.object({ confirm: z.literal(true) });

adminRouter.post(
  '/round/reset',
  ah(async (req, res) => {
    parseBody(resetSchema, req.body);
    res.json({ round: roundView(await resetRound(req.adminId!)) });
  }),
);

/* -------------------------------------------------------- monitoring/data */

adminRouter.get(
  '/live-status',
  ah(async (_req, res) => {
    res.json(await liveStatus());
  }),
);

adminRouter.get(
  '/results',
  ah(async (_req, res) => {
    await refreshRound();
    res.json({ round: roundView(await getRound()), results: await getResults() });
  }),
);

adminRouter.get(
  '/submissions',
  ah(async (_req, res) => {
    const rows = await db
      .prepare(
        `SELECT f.*, t.name AS team_name, p.name AS leader_name
         FROM final_submissions f
         JOIN teams t ON t.id = f.team_id
         JOIN participants p ON p.id = f.leader_participant_id
         ORDER BY f.created_at DESC LIMIT 500`,
      )
      .all() as {
      team_id: number;
      team_name: string;
      leader_name: string;
      submission_number: number;
      submitted_sequence: string;
      correct_positions: number;
      incorrect_positions: number;
      was_correct: number;
      created_at: number;
      elapsed_ms: number;
    }[];
    res.json({
      submissions: rows.map((row) => ({
        teamId: row.team_id,
        teamName: row.team_name,
        leader: row.leader_name,
        submissionNumber: row.submission_number,
        sequence: JSON.parse(row.submitted_sequence) as string[],
        correct: row.correct_positions,
        incorrect: row.incorrect_positions,
        completed: row.was_correct === 1,
        createdAt: row.created_at,
        elapsedMs: row.elapsed_ms,
      })),
    });
  }),
);

adminRouter.get(
  '/attempts',
  ah(async (_req, res) => {
    const rows = await db
      .prepare(
        `SELECT a.*, p.name AS participant_name, p.slot, t.name AS team_name
         FROM puzzle_attempts a
         JOIN participants p ON p.id = a.participant_id
         JOIN teams t ON t.id = a.team_id
         ORDER BY a.created_at DESC LIMIT 500`,
      )
      .all() as {
      participant_name: string;
      slot: number;
      team_name: string;
      submitted_answer: string;
      correct: number;
      attempt_number: number;
      created_at: number;
    }[];
    res.json({
      attempts: rows.map((row) => ({
        team: row.team_name,
        player: `P${row.slot} ${row.participant_name}`,
        answer: row.submitted_answer,
        correct: row.correct === 1,
        attempt: row.attempt_number,
        createdAt: row.created_at,
      })),
    });
  }),
);

adminRouter.get(
  '/logs',
  ah(async (_req, res) => {
    const rows = await db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all() as {
      id: number;
      event: string;
      actor_type: string;
      actor_id: string | null;
      team_id: number | null;
      detail: string;
      created_at: number;
    }[];
    res.json({
      logs: rows.map((row) => ({
        id: row.id,
        event: row.event,
        actorType: row.actor_type,
        actorId: row.actor_id,
        teamId: row.team_id,
        detail: JSON.parse(row.detail) as unknown,
        createdAt: row.created_at,
      })),
    });
  }),
);

adminRouter.post(
  '/rankings/recompute',
  ah(async (_req, res) => {
    await computeRankings();
    res.json({ results: await getResults() });
  }),
);
