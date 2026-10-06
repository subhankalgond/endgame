import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';

const inline = config.databaseUrl === ':memory:' || config.databaseUrl.startsWith('file:');
const dbPath = config.databaseUrl;
if (!inline) {
  const dir = dirname(dbPath);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','participant')),
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 8),
  name TEXT NOT NULL UNIQUE,
  join_token TEXT NOT NULL UNIQUE,
  correct_sequence TEXT NOT NULL,
  roster TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_join_tokens (
  token TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_join_tokens_team ON team_join_tokens(team_id);

CREATE TABLE IF NOT EXISTS team_tokens (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  reward_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, slot)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  name TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0,1)),
  puzzle_id INTEGER,
  solved_at INTEGER,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (team_id, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_team_name ON participants(team_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  alt_answers TEXT NOT NULL DEFAULT '[]',
  reward_token TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'easy',
  explanation TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, slot)
);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  submitted_answer TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0,1)),
  attempt_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_team ON puzzle_attempts(team_id);

CREATE TABLE IF NOT EXISTS final_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  leader_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  submission_number INTEGER NOT NULL,
  submitted_sequence TEXT NOT NULL,
  correct_positions INTEGER NOT NULL,
  incorrect_positions INTEGER NOT NULL,
  was_correct INTEGER NOT NULL CHECK (was_correct IN (0,1)),
  created_at INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  UNIQUE (team_id, submission_number)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (state IN ('WAITING','READY','ACTIVE','ENDED')),
  started_at INTEGER,
  ends_at INTEGER,
  ended_at INTEGER,
  duration_sec INTEGER NOT NULL DEFAULT 600,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_results (
  team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  completed_at INTEGER,
  completion_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','QUALIFIED','DISQUALIFIED')),
  rank INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  team_id INTEGER,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

db.exec(SCHEMA);

// Upgrade path for databases created before the roster column existed.
const teamColumns = db.prepare(`PRAGMA table_info(teams)`).all() as { name: string }[];
if (!teamColumns.some((col) => col.name === 'roster')) {
  db.exec(`ALTER TABLE teams ADD COLUMN roster TEXT NOT NULL DEFAULT '[]'`);
}

export function nowMs(): number {
  return Date.now();
}

export function audit(
  event: string,
  actorType: 'system' | 'admin' | 'participant',
  opts: { actorId?: string | number | null; teamId?: number | null; detail?: unknown } = {},
): void {
  db.prepare(
    `INSERT INTO audit_logs (event, actor_type, actor_id, team_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(event, actorType, opts.actorId == null ? null : String(opts.actorId), opts.teamId ?? null, JSON.stringify(opts.detail ?? {}), Date.now());
}
