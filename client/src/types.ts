export type RoundState = 'WAITING' | 'READY' | 'ACTIVE' | 'ENDED';

export type TeamState =
  | 'WAITING_FOR_PLAYERS'
  | 'READY'
  | 'TEAM_PUZZLES'
  | 'FINAL_SEQUENCE'
  | 'COMPLETED'
  | 'QUALIFIED'
  | 'DISQUALIFIED';

export interface RoundView {
  state: RoundState;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  durationSec: number;
  serverTime: number;
  remainingMs: number;
}

export interface PlayerView {
  slot: number;
  joined: boolean;
  name: string | null;
  solved: boolean;
  isLeader: boolean;
}

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

export interface ParticipantPayload {
  joined?: boolean;
  serverTime: number;
  round: RoundView;
  state: TeamState;
  team: { id: number; name: string };
  participant: { slot: number; name: string; isLeader: boolean; solvedAt: number | null };
  players: PlayerView[];
  puzzle: {
    slot: number;
    question: string;
    difficulty: string;
    solved: boolean;
    token: string | null;
  } | null;
  progress: { solvedCount: number; allSolved: boolean; teamTokens: string[] | null };
  result: { completedAt: number | null; completionTimeMs: number | null; rank: number | null; status: string } | null;
  attempts: number;
}

export interface SubmissionView {
  submissionNumber: number;
  correct: number;
  incorrect: number;
  completed: boolean;
  createdAt: number;
  elapsedMs: number;
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

export interface LiveStatus {
  serverTime: number;
  round: RoundRowDto;
  participants: number;
  readyTeams: number;
  teams: LiveTeam[];
}

export interface RoundRowDto {
  state: RoundState;
  started_at: number | null;
  ends_at: number | null;
  ended_at: number | null;
  duration_sec: number;
  updated_at: number;
  id?: number;
}

export interface AdminTeam {
  id: number;
  name: string;
  joinToken: string;
  joinUrl: string;
  correctSequence: string[];
  roster: string[];
  players: { slot: number; name: string; isLeader: boolean; solved: boolean }[];
}

export interface PuzzleView {
  id: number;
  teamId: number;
  teamName: string;
  slot: number;
  question: string;
  answer: string;
  altAnswers: string[];
  rewardToken: string;
  difficulty: string;
  explanation: string;
}

export interface QrItem {
  id: number;
  name: string;
  joinUrl: string;
  qr: string;
}

export interface AuditLogView {
  id: number;
  event: string;
  actorType: string;
  actorId: string | null;
  teamId: number | null;
  detail: unknown;
  createdAt: number;
}
