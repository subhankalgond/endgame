import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db';
import {
  getResults,
  getTeam,
  getTeamByToken,
  getTeamState,
  joinTeam,
  refreshRound,
  submitFinalSequence,
  submitPuzzleAnswer,
  teamSolvedCount,
} from '../game';
import { ah, httpError } from '../lib/http';
import { attachParticipant, parseBody, requireParticipant } from '../middleware';
import { participantPayload, playerViews, roundView, statusPayload } from '../payloads';
import { createSession, destroySession, hashToken, readSessionToken } from '../lib/session';
import { config } from '../config';

export const participantRouter = Router();

participantRouter.use(attachParticipant);

const joinLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30 * config.rateLimitFactor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a moment.', code: 'rate_limited' },
});

const submitLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60 * config.rateLimitFactor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a moment.', code: 'rate_limited' },
});

const nameSchema = z.object({ name: z.string().min(1).max(24) });
const answerSchema = z.object({ answer: z.string().min(1).max(200) });
const sequenceSchema = z.object({ sequence: z.array(z.string().min(1).max(16)).length(4) });

export async function currentParticipantId(req: Parameters<typeof readSessionToken>[0]): Promise<string | null> {
  const token = readSessionToken(req, 'participant');
  if (!token) return null;
  const row = await db
    .prepare(`SELECT participant_id FROM sessions WHERE token_hash = ? AND role = 'participant'`)
    .get(hashToken(token)) as { participant_id: string | null } | undefined;
  return row?.participant_id ?? null;
}

/* --------------------------------------------------------------- joining */

/** Public: resolve a scanned QR token to a team name (no other data). */
participantRouter.get(
  '/join/:teamToken',
  joinLimiter,
  ah(async (req, res) => {
    const token = String(req.params.teamToken ?? '');
    if (token.length < 8 || token.length > 64) throw httpError(404, 'This QR code is not valid.', 'invalid_token');
    const team = await getTeamByToken(token);
    if (!team) throw httpError(404, 'This QR code is not valid.', 'invalid_token');
    res.json({ team: { name: team.name }, serverTime: Date.now() });
  }),
);

participantRouter.post(
  '/join/:teamToken',
  joinLimiter,
  ah(async (req, res) => {
    const { name } = parseBody(nameSchema, req.body);
    const token = String(req.params.teamToken ?? '');
    if (token.length < 8 || token.length > 64) throw httpError(404, 'This QR code is not valid.', 'invalid_token');

    const existingId = await currentParticipantId(req);
    const { participant, created } = await joinTeam(token, name, existingId);

    const prior = readSessionToken(req, 'participant');
    if (prior) await destroySession('participant', prior);
    await createSession(res, 'participant', { participantId: participant.id });

    res.status(created ? 201 : 200).json({ joined: created, ...(await participantPayload(participant)) });
  }),
);

/* ----------------------------------------------------------- session/state */

participantRouter.get(
  '/session',
  requireParticipant,
  ah(async (req, res) => {
    res.json(await participantPayload(req.participant!));
  }),
);

participantRouter.get(
  '/round/status',
  ah(async (_req, res) => {
    res.json(roundView(await refreshRound()));
  }),
);

participantRouter.get(
  '/team/status',
  requireParticipant,
  ah(async (req, res) => {
    res.json(await statusPayload(req.participant!));
  }),
);

participantRouter.get(
  '/my-puzzle',
  requireParticipant,
  ah(async (req, res) => {
    const payload = await participantPayload(req.participant!);
    res.json({ puzzle: payload.puzzle, round: payload.round, state: payload.state, participant: payload.participant });
  }),
);

participantRouter.get(
  '/team/progress',
  requireParticipant,
  ah(async (req, res) => {
    const participant = req.participant!;
    const team = await getTeam(participant.team_id);
    const solvedCount = await teamSolvedCount(team.id);
    res.json({
      team: { id: team.id, name: team.name },
      players: await playerViews(team.id),
      progress: { solvedCount, allSolved: solvedCount === 4 },
      isLeader: participant.is_leader === 1,
      state: await getTeamState(team.id, await refreshRound()),
    });
  }),
);

participantRouter.get(
  '/team/submissions',
  requireParticipant,
  ah(async (req, res) => {
    const participant = req.participant!;
    const rows = await db
      .prepare(
        `SELECT submission_number, correct_positions, incorrect_positions, was_correct, created_at, elapsed_ms
         FROM final_submissions WHERE team_id = ? ORDER BY submission_number`,
      )
      .all(participant.team_id) as {
      submission_number: number;
      correct_positions: number;
      incorrect_positions: number;
      was_correct: number;
      created_at: number;
      elapsed_ms: number;
    }[];
    res.json({
      submissions: rows.map((row) => ({
        submissionNumber: row.submission_number,
        correct: row.correct_positions,
        incorrect: row.incorrect_positions,
        completed: row.was_correct === 1,
        createdAt: row.created_at,
        elapsedMs: row.elapsed_ms,
      })),
      totalAttempts: rows.length,
    });
  }),
);

/* -------------------------------------------------------------- gameplay */

participantRouter.post(
  '/puzzle/submit',
  requireParticipant,
  submitLimiter,
  ah(async (req, res) => {
    const { answer } = parseBody(answerSchema, req.body);
    res.json(await submitPuzzleAnswer(req.participant!, answer));
  }),
);

participantRouter.post(
  '/team/final-submit',
  requireParticipant,
  submitLimiter,
  ah(async (req, res) => {
    const { sequence } = parseBody(sequenceSchema, req.body);
    res.json(await submitFinalSequence(req.participant!, sequence));
  }),
);

/* --------------------------------------------------------------- results */

participantRouter.get(
  '/results',
  requireParticipant,
  ah(async (_req, res) => {
    const round = await refreshRound();
    if (round.state !== 'ENDED') throw httpError(409, 'Round 1 is still running.', 'round_active');
    res.json({ round: roundView(round), results: await getResults() });
  }),
);
