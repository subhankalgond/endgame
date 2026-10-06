import { db } from './db';
import type { ParticipantRow } from './game';
import {
  getParticipants,
  getPuzzleById,
  getRound,
  getTeam,
  getTeamState,
  refreshRound,
  teamSolvedCount,
  teamTokens,
  type PuzzleRow,
  type RoundRow,
} from './game';

export interface PlayerView {
  slot: number;
  joined: boolean;
  name: string | null;
  solved: boolean;
  isLeader: boolean;
}

export function roundView(round: RoundRow): {
  state: string;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  durationSec: number;
  serverTime: number;
  remainingMs: number;
} {
  const now = Date.now();
  return {
    state: round.state,
    startedAt: round.started_at,
    endsAt: round.ends_at,
    endedAt: round.ended_at,
    durationSec: round.duration_sec,
    serverTime: now,
    remainingMs: round.state === 'ACTIVE' && round.ends_at ? Math.max(0, round.ends_at - now) : 0,
  };
}

export function playerViews(teamId: number): PlayerView[] {
  const joined = getParticipants(teamId);
  const bySlot = new Map(joined.map((p) => [p.slot, p]));
  return [1, 2, 3, 4].map((slot) => {
    const p = bySlot.get(slot);
    return {
      slot,
      joined: Boolean(p),
      name: p?.name ?? null,
      solved: Boolean(p && p.solved_at),
      isLeader: Boolean(p && p.is_leader === 1),
    };
  });
}

/**
 * The only payload a participant ever receives: their own puzzle, their own
 * token, team roster state and server timing. Never the correct sequence.
 */
export function participantPayload(participant: ParticipantRow): Record<string, unknown> {
  const round = refreshRound();
  const team = getTeam(participant.team_id);
  const puzzle: PuzzleRow | null = participant.puzzle_id ? getPuzzleById(participant.puzzle_id) : null;
  const solvedCount = teamSolvedCount(team.id);
  const allSolved = solvedCount === 4;
  const attempts = (
    db.prepare('SELECT COUNT(*) AS c FROM puzzle_attempts WHERE participant_id = ?').get(participant.id) as { c: number }
  ).c;

  return {
    serverTime: Date.now(),
    round: roundView(round),
    state: getTeamState(team.id, round),
    team: { id: team.id, name: team.name },
    participant: {
      slot: participant.slot,
      name: participant.name,
      isLeader: participant.is_leader === 1,
      solvedAt: participant.solved_at,
    },
    players: playerViews(team.id),
    puzzle: puzzle
      ? {
          slot: participant.slot,
          question: puzzle.question,
          difficulty: puzzle.difficulty,
          solved: participant.solved_at != null,
          token: participant.solved_at ? puzzle.reward_token : null,
        }
      : null,
    progress: {
      solvedCount,
      allSolved,
      // Only the four earned tokens are shared once the whole team is done.
      teamTokens: allSolved ? teamTokens(team.id) : null,
    },
    result: resultView(team.id),
    attempts,
  };
}

/** Completion record for this team; null until the team finishes. */
export function resultView(teamId: number): {
  completedAt: number | null;
  completionTimeMs: number | null;
  rank: number | null;
  status: string;
} | null {
  const row = db.prepare(
    'SELECT completed_at, completion_time_ms, rank, status FROM team_results WHERE team_id = ?',
  ).get(teamId) as
    | { completed_at: number | null; completion_time_ms: number | null; rank: number | null; status: string }
    | undefined;
  if (!row) return null;
  return {
    completedAt: row.completed_at,
    completionTimeMs: row.completion_time_ms,
    rank: row.rank,
    status: row.status,
  };
}

export function statusPayload(participant: ParticipantRow): Record<string, unknown> {
  const round = refreshRound();
  const team = getTeam(participant.team_id);
  return {
    team: { id: team.id, name: team.name },
    state: getTeamState(team.id, round),
    players: playerViews(team.id),
    round: roundView(round),
  };
}

export function resultsVisibility(round: RoundRow): boolean {
  return round.state === 'ENDED';
}

export function currentRound(): RoundRow {
  return getRound();
}
