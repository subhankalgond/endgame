import { randomInt } from 'node:crypto';
import { audit, db, nowMs } from './db';
import { httpError } from './lib/http';
import { broadcastLive, broadcastTeam, emitToAll, emitToAdmins, emitToTeam } from './realtime';

export type RoundState = 'WAITING' | 'READY' | 'ACTIVE' | 'ENDED';

export type TeamState =
  | 'WAITING_FOR_PLAYERS'
  | 'READY'
  | 'TEAM_PUZZLES'
  | 'FINAL_SEQUENCE'
  | 'COMPLETED'
  | 'QUALIFIED'
  | 'DISQUALIFIED';

export interface RoundRow {
  id: number;
  state: RoundState;
  started_at: number | null;
  ends_at: number | null;
  ended_at: number | null;
  duration_sec: number;
  updated_at: number;
}

export interface TeamRow {
  id: number;
  name: string;
  join_token: string;
  correct_sequence: string;
}

export interface ParticipantRow {
  id: string;
  team_id: number;
  slot: number;
  name: string;
  is_leader: number;
  puzzle_id: number | null;
  solved_at: number | null;
  joined_at: number;
  last_seen_at: number;
}

export interface PuzzleRow {
  id: number;
  team_id: number;
  slot: number;
  question: string;
  answer: string;
  alt_answers: string;
  reward_token: string;
  difficulty: string;
  explanation: string;
}

export interface ResultRow {
  team_id: number;
  completed_at: number | null;
  completion_time_ms: number | null;
  status: string;
  rank: number | null;
  updated_at: number;
}

/* ------------------------------------------------------------------ rounds */

export async function getRound(): Promise<RoundRow> {
  let row = await db.prepare('SELECT * FROM rounds WHERE id = 1').get() as unknown as RoundRow | undefined;
  if (!row) {
    await db.prepare('INSERT INTO rounds (id, state, duration_sec, updated_at) VALUES (1, ?, ?, ?)').run(
      'WAITING',
      600,
      nowMs(),
    );
    row = await db.prepare('SELECT * FROM rounds WHERE id = 1').get() as unknown as RoundRow;
  }
  return row;
}

export async function prepareRound(actorId: number): Promise<RoundRow> {
  const round = await getRound();
  if (round.state === 'ACTIVE') throw httpError(409, 'Round is already active.', 'active');
  if (round.state === 'ENDED') throw httpError(409, 'Round has ended. Reset the round before preparing it again.', 'ended');
  await db.prepare("UPDATE rounds SET state = 'READY', updated_at = ? WHERE id = 1").run(nowMs());
  audit('round_prepared', 'admin', { actorId, detail: { from: round.state } });
  emitToAll('round_state', { state: 'READY' });
  broadcastLive();
  return await getRound();
}

export async function startRound(actorId: number): Promise<RoundRow> {
  const round = await getRound();
  if (round.state === 'ACTIVE') throw httpError(409, 'Round is already active.', 'active');
  if (round.state === 'ENDED') throw httpError(409, 'Round has ended. Reset the round before starting it again.', 'ended');
  const now = nowMs();
  const endsAt = now + round.duration_sec * 1000;
  await db.prepare("UPDATE rounds SET state = 'ACTIVE', started_at = ?, ends_at = ?, ended_at = NULL, updated_at = ? WHERE id = 1").run(
    now,
    endsAt,
    now,
  );
  audit('round_started', 'admin', { actorId, detail: { startedAt: now, endsAt, durationSec: round.duration_sec } });
  emitToAll('round_started', { startedAt: now, endsAt, durationSec: round.duration_sec, serverTime: now });
  broadcastLive();
  return await getRound();
}

export async function computeRankings(): Promise<void> {
  const teams = await db.prepare('SELECT id, name FROM teams ORDER BY id').all() as { id: number; name: string }[];
  const now = nowMs();

  const agg = await Promise.all(teams.map(async (team) => {
    const result = (await db.prepare('SELECT * FROM team_results WHERE team_id = ?').get(team.id) as ResultRow | undefined) ?? {
      team_id: team.id,
      completed_at: null,
      completion_time_ms: null,
      status: 'PENDING',
      rank: null,
      updated_at: now,
    };
    const solved = (
      await db.prepare('SELECT COUNT(*) AS c FROM participants WHERE team_id = ? AND solved_at IS NOT NULL').get(team.id) as { c: number }
    ).c;
    const wrongPuzzles = (
      await db.prepare('SELECT COUNT(*) AS c FROM puzzle_attempts WHERE team_id = ? AND correct = 0').get(team.id) as { c: number }
    ).c;
    const wrongFinals = (
      await db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = ? AND was_correct = 0').get(team.id) as { c: number }
    ).c;
    const lastActivity =
      (
        await db.prepare('SELECT MAX(created_at) AS m FROM puzzle_attempts WHERE team_id = ?').get(team.id) as { m: number | null }
      ).m ??
      (await db.prepare('SELECT MAX(joined_at) AS m FROM participants WHERE team_id = ?').get(team.id) as { m: number | null }).m ??
      now;
    return {
      teamId: team.id,
      name: team.name,
      solved,
      completedAt: result.completed_at,
      completionTimeMs: result.completion_time_ms,
      wrongPuzzles,
      wrongFinals,
      lastActivity,
    };
  }));

  agg.sort((a, b) => {
    const aDone = a.completionTimeMs != null;
    const bDone = b.completionTimeMs != null;
    if (aDone !== bDone) return aDone ? -1 : 1;
    if (aDone && bDone) {
      if (a.completionTimeMs! !== b.completionTimeMs!) return a.completionTimeMs! - b.completionTimeMs!;
      if (a.wrongFinals !== b.wrongFinals) return a.wrongFinals - b.wrongFinals;
      if (a.wrongPuzzles !== b.wrongPuzzles) return a.wrongPuzzles - b.wrongPuzzles;
      return (a.completedAt ?? 0) - (b.completedAt ?? 0);
    }
    if (a.solved !== b.solved) return b.solved - a.solved;
    if (a.wrongFinals !== b.wrongFinals) return a.wrongFinals - b.wrongFinals;
    if (a.wrongPuzzles !== b.wrongPuzzles) return a.wrongPuzzles - b.wrongPuzzles;
    return a.lastActivity - b.lastActivity;
  });

  const update = await db.prepare(
    'UPDATE team_results SET rank = ?, status = ?, updated_at = ? WHERE team_id = ?',
  );
  agg.forEach((row, index) => {
    const rank = index + 1;
    const status = row.completionTimeMs != null && rank <= 4 ? 'QUALIFIED' : 'DISQUALIFIED';
    update.run(rank, status, now, row.teamId);
  });
}

export async function endRound(reason: 'admin' | 'expired', actorId?: number): Promise<RoundRow> {
  const round = await getRound();
  if (round.state === 'ENDED') return round;
  const now = nowMs();
  await db.prepare("UPDATE rounds SET state = 'ENDED', ended_at = ?, updated_at = ? WHERE id = 1").run(now, now);
  await computeRankings();
  audit(reason === 'expired' ? 'round_time_expired' : 'round_ended', reason === 'expired' ? 'system' : 'admin', {
    actorId: actorId ?? null,
    detail: { reason, endedAt: now },
  });
  emitToAll('round_ended', { reason, serverTime: now });
  emitToAdmins('results_updated', { at: now });
  broadcastLive();
  return await getRound();
}

/** Auto-finish the round when the server clock passes roundEndsAt. */
export async function refreshRound(): Promise<RoundRow> {
  const round = await getRound();
  if (round.state === 'ACTIVE' && round.ends_at && nowMs() >= round.ends_at) {
    return await endRound('expired');
  }
  return round;
}

export async function resetRound(actorId: number): Promise<RoundRow> {
  const now = nowMs();
  await db.tx(async () => {
    await db.prepare('DELETE FROM sessions WHERE role = ?').run('participant');
    await db.prepare('DELETE FROM puzzle_attempts').run();
    await db.prepare('DELETE FROM final_submissions').run();
    await db.prepare('DELETE FROM participants').run();
    await db.prepare('UPDATE team_results SET completed_at = NULL, completion_time_ms = NULL, status = ?, rank = NULL, updated_at = ?').run(
      'PENDING',
      now,
    );
    await db.prepare(
      "UPDATE rounds SET state = 'WAITING', started_at = NULL, ends_at = NULL, ended_at = NULL, updated_at = ? WHERE id = 1",
    ).run(now);
  });
  audit('admin_reset_round', 'admin', { actorId, detail: { at: now } });
  emitToAll('round_reset', { serverTime: now });
  broadcastLive();
  return await getRound();
}

/* ------------------------------------------------------------------- teams */

export async function getTeam(teamId: number): Promise<TeamRow> {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
  if (!team) throw httpError(404, 'Team not found.', 'not_found');
  return team;
}

export async function getTeamByToken(token: string): Promise<TeamRow | null> {
  return (await db.prepare('SELECT * FROM teams WHERE join_token = ?').get(token) as TeamRow | undefined) ?? null;
}

export async function getParticipants(teamId: number): Promise<ParticipantRow[]> {
  return await db
    .prepare('SELECT * FROM participants WHERE team_id = ? ORDER BY slot')
    .all(teamId) as unknown as ParticipantRow[];
}

export async function getPuzzleForSlot(teamId: number, slot: number): Promise<PuzzleRow> {
  const puzzle = await db.prepare('SELECT * FROM puzzles WHERE team_id = ? AND slot = ?').get(teamId, slot) as
    | PuzzleRow
    | undefined;
  if (!puzzle) throw httpError(500, 'Unable to process the request.', 'puzzle_missing');
  return puzzle;
}

export async function getPuzzleById(puzzleId: number): Promise<PuzzleRow | null> {
  return (await db.prepare('SELECT * FROM puzzles WHERE id = ?').get(puzzleId) as PuzzleRow | undefined) ?? null;
}

export async function teamTokens(teamId: number): Promise<string[]> {
  const rows = await db
    .prepare('SELECT slot, reward_token FROM team_tokens WHERE team_id = ? ORDER BY slot')
    .all(teamId) as { slot: number; reward_token: string }[];
  if (rows.length === 4) return rows.map((row) => row.reward_token);
  // Self-healing path for databases created before the team_tokens table existed.
  return (
    await db.prepare('SELECT slot, reward_token FROM puzzles WHERE team_id = ? ORDER BY slot').all(teamId) as {
      slot: number;
      reward_token: string;
    }[]
  ).map((row) => row.reward_token);
}

export async function readCorrectSequence(teamId: number): Promise<string[]> {
  const team = await getTeam(teamId);
  try {
    const parsed = JSON.parse(team.correct_sequence) as unknown;
    if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((t) => typeof t === 'string')) {
      return parsed as string[];
    }
  } catch {
    /* fall through */
  }
  throw httpError(500, 'Unable to process the request.', 'sequence_config');
}

/** Called when the fourth participant joins: pick the leader and hand out puzzles. */
export async function armTeam(teamId: number): Promise<{ leaderId: string } | null> {
  const players = await getParticipants(teamId);
  if (players.length !== 4) return null;
  const alreadyArmed = players.some((p) => p.is_leader === 1);
  if (alreadyArmed) {
    const leader = players.find((p) => p.is_leader === 1)!;
    return { leaderId: leader.id };
  }

  const leaderIndex = randomInt(0, players.length);
  const leader = players[leaderIndex];
  const now = nowMs();
  const armedLeaderId = await db.tx(async () => {
    const setLeader = await db.prepare(
      'UPDATE participants SET is_leader = ?, puzzle_id = ?, last_seen_at = ? WHERE id = ?',
    );
    for (const player of players) {
      const puzzle = await getPuzzleForSlot(teamId, player.slot);
      await setLeader.run(player.id === leader.id ? 1 : 0, puzzle.id, now, player.id);
    }
    return leader.id;
  });
  audit('leader_selected', 'system', { teamId, actorId: leader.id, detail: { slot: leader.slot } });
  audit('puzzles_assigned', 'system', { teamId, detail: { players: 4 } });
  emitToTeam(teamId, 'all_players_ready', { teamId, players: 4 });
  emitToTeam(teamId, 'leader_selected', { teamId, leaderSlot: leader.slot });
  broadcastTeam(teamId, 'ready');
  return { leaderId: armedLeaderId };
}

export async function teamSolvedCount(teamId: number): Promise<number> {
  return (
    await db.prepare('SELECT COUNT(*) AS c FROM participants WHERE team_id = ? AND solved_at IS NOT NULL').get(teamId) as {
      c: number;
    }
  ).c;
}

export async function getTeamState(teamId: number, round: RoundRow): Promise<TeamState> {
  const players = await getParticipants(teamId);
  if (round.state === 'ENDED') {
    const result = await db.prepare('SELECT status FROM team_results WHERE team_id = ?').get(teamId) as
      | { status: string }
      | undefined;
    if (result && result.status === 'QUALIFIED') return 'QUALIFIED';
    return 'DISQUALIFIED';
  }
  if (players.length < 4) return 'WAITING_FOR_PLAYERS';
  const solved = await teamSolvedCount(teamId);
  if (solved === 4) {
    const correct = await db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = ? AND was_correct = 1').get(
      teamId,
    ) as { c: number };
    if (correct.c > 0) return 'COMPLETED';
  }
  if (round.state !== 'ACTIVE') return 'READY';
  return solved === 4 ? 'FINAL_SEQUENCE' : 'TEAM_PUZZLES';
}

export async function solvedFlags(teamId: number): Promise<{ slot: number; solved: boolean }[]> {
  const rows = await db
    .prepare('SELECT slot, solved_at FROM participants WHERE team_id = ? ORDER BY slot')
    .all(teamId) as { slot: number; solved_at: number | null }[];
  return rows.map((row) => ({ slot: row.slot, solved: row.solved_at != null }));
}

export interface LiveTeam {
  id: number;
  name: string;
  players: number;
  leaderSlot: number | null;
  leaderName: string | null;
  solved: number;
  finalAttempts: number;
  lastFeedback: { correct: number; incorrect: number } | null;
  completedAt: number | null;
  completionTimeMs: number | null;
  status: TeamState;
}

export async function liveStatus(): Promise<{
  serverTime: number;
  round: RoundRow;
  participants: number;
  readyTeams: number;
  teams: LiveTeam[];
}> {
  const round = await refreshRound();
  const teams = await db.prepare('SELECT id, name FROM teams ORDER BY id').all() as { id: number; name: string }[];
  const totalPlayers = (await db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c;
  const live: LiveTeam[] = await Promise.all(
    teams.map(async (team) => {
      const players = await getParticipants(team.id);
      const leader = players.find((p) => p.is_leader === 1) ?? null;
      const solved = await teamSolvedCount(team.id);
      const attempts = await db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = ?').get(team.id) as {
        c: number;
      };
      const last = await db.prepare(
        'SELECT correct_positions, incorrect_positions FROM final_submissions WHERE team_id = ? ORDER BY submission_number DESC LIMIT 1',
      ).get(team.id) as { correct_positions: number; incorrect_positions: number } | undefined;
      const result = await db.prepare('SELECT completed_at, completion_time_ms FROM team_results WHERE team_id = ?').get(team.id) as
        | { completed_at: number | null; completion_time_ms: number | null }
        | undefined;
      return {
        id: team.id,
        name: team.name,
        players: players.length,
        leaderSlot: leader ? leader.slot : null,
        leaderName: leader ? leader.name : null,
        solved,
        finalAttempts: attempts.c,
        lastFeedback: last ? { correct: last.correct_positions, incorrect: last.incorrect_positions } : null,
        completedAt: result?.completed_at ?? null,
        completionTimeMs: result?.completion_time_ms ?? null,
        status: await getTeamState(team.id, round),
      };
    }),
  );
  return {
    serverTime: nowMs(),
    round,
    participants: totalPlayers,
    readyTeams: live.filter((t) => t.players === 4).length,
    teams: live,
  };
}

/* ------------------------------------------------------------------ join */

export async function joinTeam(
  token: string,
  name: string,
  existingParticipantId: string | null,
): Promise<{ participant: ParticipantRow; created: boolean; reconnected: boolean }> {
  await refreshRound();
  const team = await getTeamByToken(token);
  if (!team) throw httpError(404, 'This QR code is not valid.', 'invalid_token');

  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 24) {
    throw httpError(400, 'Enter a name between 2 and 24 characters.', 'invalid_name');
  }
  if (!/^[A-Za-z0-9 ._-]+$/.test(cleanName)) {
    throw httpError(400, 'Name may only contain letters, numbers, spaces, dots, dashes and underscores.', 'invalid_name');
  }

  // Existing session: return the same participant (refresh / reconnect).
  if (existingParticipantId) {
    const existing = await db.prepare('SELECT * FROM participants WHERE id = ?').get(existingParticipantId) as
      | ParticipantRow
      | undefined;
    if (existing) {
      if (existing.team_id !== team.id) throw httpError(403, 'This device is already registered with another team.', 'other_team');
      await db.prepare('UPDATE participants SET last_seen_at = ?, name = ? WHERE id = ?').run(nowMs(), cleanName, existing.id);
      const refreshed = await db.prepare('SELECT * FROM participants WHERE id = ?').get(existing.id) as unknown as ParticipantRow;
      if ((await getParticipants(team.id)).length === 4) await armTeam(team.id);
      audit('participant_reconnected', 'participant', { actorId: existing.id, teamId: team.id, detail: { slot: existing.slot } });
      broadcastTeam(team.id, 'reconnected');
      return { participant: refreshed, created: false, reconnected: false };
    }
  }

  const current = await getParticipants(team.id);
  const byName = current.find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  if (byName) {
    // Same name re-scanning on a new/cleared device: hand back the same await slot.
    await db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?').run(nowMs(), byName.id);
    audit('participant_reconnected', 'participant', { actorId: byName.id, teamId: team.id, detail: { slot: byName.slot } });
    if ((await getParticipants(team.id)).length === 4) await armTeam(team.id);
    broadcastTeam(team.id, 'reconnected');
    return { participant: await db.prepare('SELECT * FROM participants WHERE id = ?').get(byName.id) as unknown as ParticipantRow, created: false, reconnected: true };
  }

  if (current.length >= 4) throw httpError(409, 'This team already has 4 players.', 'team_full');

  const usedSlots = new Set(current.map((p) => p.slot));
  let slot = 1;
  while (usedSlots.has(slot)) slot += 1;

  const id = `p_${team.id}_${slot}_${randomId()}`;
  const now = nowMs();
  await db.prepare(
    'INSERT INTO participants (id, team_id, slot, name, is_leader, puzzle_id, joined_at, last_seen_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)',
  ).run(id, team.id, slot, cleanName, now, now);
  audit('participant_joined', 'participant', { actorId: id, teamId: team.id, detail: { slot, name: cleanName } });

  const created = await db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as unknown as ParticipantRow;
  if ((await getParticipants(team.id)).length === 4) await armTeam(team.id);
  broadcastTeam(team.id, 'player_joined');
  emitToTeam(team.id, 'player_joined', { teamId: team.id, players: (await getParticipants(team.id)).length });
  return { participant: created, created: true, reconnected: false };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* --------------------------------------------------------------- answers */

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function submitPuzzleAnswer(participant: ParticipantRow, answer: string): Promise<{ correct: boolean; token?: string; attempts: number }> {
  const round = await refreshRound();
  if (round.ends_at && nowMs() >= round.ends_at) throw httpError(410, "TIME'S UP. Round 1 has ended.", 'time_expired');
  if (round.state !== 'ACTIVE') {
    throw httpError(409, round.state === 'ENDED' ? 'Round 1 has ended.' : 'The round has not started yet.', 'round_not_active');
  }

  const clean = answer.trim();
  if (!clean) throw httpError(400, 'Enter an answer.', 'empty_answer');
  if (clean.length > 200) throw httpError(400, 'Answer is too long.', 'too_long');
  if (participant.solved_at) throw httpError(409, 'You already solved your puzzle.', 'already_solved');
  if (!participant.puzzle_id) throw httpError(409, 'No puzzle assigned yet.', 'no_puzzle');

  const puzzle = await getPuzzleById(participant.puzzle_id);
  if (!puzzle || puzzle.team_id !== participant.team_id) throw httpError(403, 'Unable to process the request.', 'puzzle_mismatch');

  const attemptNumber =
    (await db.prepare('SELECT COUNT(*) AS c FROM puzzle_attempts WHERE participant_id = ?').get(participant.id) as { c: number }).c + 1;

  let alts: string[] = [];
  try {
    const parsed = JSON.parse(puzzle.alt_answers) as unknown;
    if (Array.isArray(parsed)) alts = parsed.filter((a): a is string => typeof a === 'string');
  } catch {
    alts = [];
  }

  const expected = [puzzle.answer, ...alts].map(normalize);
  const correct = expected.includes(normalize(clean));

  await db.prepare(
    'INSERT INTO puzzle_attempts (participant_id, team_id, puzzle_id, submitted_answer, correct, attempt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(participant.id, participant.team_id, puzzle.id, clean.slice(0, 200), correct ? 1 : 0, attemptNumber, nowMs());

  if (correct) {
    const now = nowMs();
    await db.prepare('UPDATE participants SET solved_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, participant.id);
    audit('puzzle_solved', 'participant', {
      actorId: participant.id,
      teamId: participant.team_id,
      detail: { slot: participant.slot, attempts: attemptNumber },
    });
    emitToTeam(participant.team_id, 'puzzle_solved', { teamId: participant.team_id, slot: participant.slot });
    broadcastTeam(participant.team_id, 'puzzle_solved');
    if (await teamSolvedCount(participant.team_id) === 4) {
      emitToTeam(participant.team_id, 'team_progress_updated', { teamId: participant.team_id, allSolved: true });
    }
    return { correct: true, token: puzzle.reward_token, attempts: attemptNumber };
  }

  audit('puzzle_submitted', 'participant', {
    actorId: participant.id,
    teamId: participant.team_id,
    detail: { slot: participant.slot, attempt: attemptNumber, correct: false },
  });
  broadcastTeam(participant.team_id, 'attempt');
  return { correct: false, attempts: attemptNumber };
}

export interface FinalResult {
  correct: number;
  incorrect: number;
  submissionNumber: number;
  completed: boolean;
  duplicate: boolean;
}

export async function submitFinalSequence(participant: ParticipantRow, sequence: string[]): Promise<FinalResult> {
  const round = await refreshRound();
  if (round.ends_at && nowMs() >= round.ends_at) throw httpError(410, "TIME'S UP. Round 1 has ended.", 'time_expired');
  if (round.state !== 'ACTIVE') {
    throw httpError(409, round.state === 'ENDED' ? 'Round 1 has ended.' : 'The round has not started yet.', 'round_not_active');
  }
  if (participant.is_leader !== 1) throw httpError(403, 'Only the team leader can submit the final sequence.', 'not_leader');

  const players = await getParticipants(participant.team_id);
  if (players.length < 4) throw httpError(409, 'Your team is not complete yet.', 'team_incomplete');
  if (await teamSolvedCount(participant.team_id) !== 4) {
    throw httpError(409, 'Your team must solve all four puzzles first.', 'puzzles_incomplete');
  }

  const tokens = await teamTokens(participant.team_id);
  if (sequence.length !== 4) throw httpError(400, 'Submit exactly four tokens.', 'invalid_sequence');
  const unique = new Set(sequence);
  if (unique.size !== 4) throw httpError(400, 'Each token must be used exactly once.', 'invalid_sequence');
  for (const token of sequence) {
    if (!tokens.includes(token)) throw httpError(400, 'Invalid token in sequence.', 'invalid_sequence');
  }

  const now = nowMs();

  // Duplicate tap protection: identical repeat inside a short window returns the stored result.
  const last = await db
    .prepare('SELECT * FROM final_submissions WHERE team_id = ? ORDER BY submission_number DESC LIMIT 1')
    .get(participant.team_id) as
    | {
        id: number;
        submission_number: number;
        submitted_sequence: string;
        correct_positions: number;
        incorrect_positions: number;
        was_correct: number;
        created_at: number;
      }
    | undefined;
  if (last && last.created_at > now - 4000 && last.submitted_sequence === JSON.stringify(sequence)) {
    return {
      correct: last.correct_positions,
      incorrect: last.incorrect_positions,
      submissionNumber: last.submission_number,
      completed: last.was_correct === 1,
      duplicate: true,
    };
  }

  const correctSequence = await readCorrectSequence(participant.team_id);
  let correct = 0;
  for (let i = 0; i < 4; i += 1) {
    if (sequence[i] === correctSequence[i]) correct += 1;
  }
  const incorrect = 4 - correct;
  const completed = correct === 4;

  const submissionNumber = last ? last.submission_number + 1 : 1;
  const elapsed = round.started_at ? now - round.started_at : 0;
  await db.prepare(
    `INSERT INTO final_submissions
      (team_id, leader_participant_id, submission_number, submitted_sequence, correct_positions, incorrect_positions, was_correct, created_at, elapsed_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    participant.team_id,
    participant.id,
    submissionNumber,
    JSON.stringify(sequence),
    correct,
    incorrect,
    completed ? 1 : 0,
    now,
    elapsed,
  );

  audit('final_sequence_submitted', 'participant', {
    actorId: participant.id,
    teamId: participant.team_id,
    detail: { submissionNumber, correct, incorrect, completed },
  });

  if (completed) {
    await db.prepare('UPDATE team_results SET completed_at = ?, completion_time_ms = ?, updated_at = ? WHERE team_id = ?').run(
      now,
      elapsed,
      now,
      participant.team_id,
    );
    await computeRankings();
    audit('team_completed', 'system', { teamId: participant.team_id, detail: { completionTimeMs: elapsed, submissionNumber } });
    emitToTeam(participant.team_id, 'team_completed', { teamId: participant.team_id, completionTimeMs: elapsed });
    emitToAdmins('team_completed', { teamId: participant.team_id, completionTimeMs: elapsed });
  } else {
    emitToTeam(participant.team_id, 'final_feedback', {
      teamId: participant.team_id,
      submissionNumber,
      correct,
      incorrect,
    });
  }
  broadcastTeam(participant.team_id, 'final_submission');
  emitToAdmins('results_updated', { at: now });

  return { correct, incorrect, submissionNumber, completed, duplicate: false };
}

/* ------------------------------------------------------------- results */

export interface ResultView {
  rank: number;
  teamId: number;
  teamName: string;
  puzzlesSolved: number;
  finalAttempts: number;
  completed: boolean;
  completionTimeMs: number | null;
  status: 'QUALIFIED' | 'DISQUALIFIED';
}

export async function getResults(): Promise<ResultView[]> {
  await refreshRound();
  const teams = await db.prepare('SELECT id, name FROM teams ORDER BY id').all() as { id: number; name: string }[];
  const rows = await Promise.all(teams.map(async (team) => {
    const result = (await db.prepare('SELECT * FROM team_results WHERE team_id = ?').get(team.id) as ResultRow | undefined) ?? null;
    const solved = await teamSolvedCount(team.id);
    const attempts = (await db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = ?').get(team.id) as { c: number }).c;
    return {
      rank: result?.rank ?? 99,
      teamId: team.id,
      teamName: team.name,
      puzzlesSolved: solved,
      finalAttempts: attempts,
      completed: result?.completion_time_ms != null,
      completionTimeMs: result?.completion_time_ms ?? null,
      status: (result?.status === 'QUALIFIED' ? 'QUALIFIED' : 'DISQUALIFIED') as 'QUALIFIED' | 'DISQUALIFIED',
    };
  }));
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}
