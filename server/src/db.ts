import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client, Pool, types } from 'pg';
import { config } from './config';

// node-postgres returns bigint as a string; every bigint value in this schema
// (ids, counts, millisecond timestamps) is well inside Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (value) => Number(value));

type Row = Record<string, unknown>;

interface QueryResult {
  rows: Row[];
  rowCount: number;
}

/** The unit a query runs against: either the shared pool or one open transaction. */
interface Ctx {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
}

interface TxHandle {
  ctx: Ctx;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface Driver {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  beginTx(): Promise<TxHandle>;
  close(): Promise<void>;
}

const als = new AsyncLocalStorage<Ctx>();

/* ----------------------------------------------------------- SQL rewriting */

const paramCache = new Map<string, string>();

/** Convert SQLite-style `?` placeholders to Postgres `$1..$n`, skipping literals. */
function toParams(sql: string): string {
  const cached = paramCache.get(sql);
  if (cached !== undefined) return cached;
  let out = '';
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (const ch of sql) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '?' && !inSingle && !inDouble) {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  paramCache.set(sql, out);
  return out;
}


/* --------------------------------------------------------------- drivers */

function sslOption(connectionString: string): object | undefined {
  let mode: string | null = null;
  try {
    mode = new URL(connectionString).searchParams.get('sslmode');
  } catch {
    mode = null;
  }
  if (!mode || mode === 'disable') return undefined;
  if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function createPgDriver(connectionString: string): Driver {
  const pool = new Pool({
    connectionString,
    ssl: sslOption(connectionString),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  pool.on('error', (err) => {
    console.error('[endgame] idle postgres client error:', err.message);
  });

  const driver: Driver = {
    async query(sql, params) {
      const res = await pool.query(toParams(sql), params ?? []);
      return { rows: res.rows as Row[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async beginTx() {
      const client = await pool.connect();
      const ctx: Ctx = {
        async query(sql, params) {
          const res = await client.query(toParams(sql), params ?? []);
          return { rows: res.rows as Row[], rowCount: res.rowCount ?? res.rows.length };
        },
        async exec(sql) {
          await client.query(sql);
        },
      };
      await ctx.exec('BEGIN');
      return {
        ctx,
        async commit() {
          await ctx.exec('COMMIT');
        },
        async rollback() {
          try {
            await ctx.exec('ROLLBACK');
          } catch {
            /* connection already broken */
          }
        },
        release() {
          client.release();
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
  return driver;
}

async function createPgliteDriver(connectionString: string): Promise<Driver> {
  // Native dynamic import keeps the ESM/WASM build of PGlite intact under the
  // CommonJS server bundle.
  const { PGlite } = await import('@electric-sql/pglite');

  let dataDir: string | undefined;
  if (connectionString !== ':memory:' && !connectionString.startsWith('file:')) {
    dataDir = connectionString;
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  const pg = new PGlite(dataDir);

  const ctxFor = (target: typeof pg): Ctx => ({
    async query(sql, params) {
      const res = await target.query(toParams(sql), params ?? []);
      return { rows: res.rows as Row[], rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(sql) {
      await target.exec(sql);
    },
  });
  const base = ctxFor(pg);

  const driver: Driver = {
    query: (sql, params) => base.query(sql, params),
    exec: (sql) => base.exec(sql),
    async beginTx() {
      const ctx = ctxFor(pg);
      await ctx.exec('BEGIN');
      return {
        ctx,
        async commit() {
          await ctx.exec('COMMIT');
        },
        async rollback() {
          try {
            await ctx.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
        },
        release() {
          /* single shared connection */
        },
      };
    },
    async close() {
      await pg.close();
    },
  };
  return driver;
}

/* -------------------------------------------------- driver initialisation */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 8),
  name TEXT NOT NULL UNIQUE,
  join_token TEXT NOT NULL UNIQUE,
  correct_sequence TEXT NOT NULL,
  roster TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  alt_answers TEXT NOT NULL DEFAULT '[]',
  reward_token TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'easy',
  explanation TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL,
  UNIQUE (team_id, slot)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  name TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0,1)),
  puzzle_id INTEGER,
  solved_at BIGINT,
  joined_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  UNIQUE (team_id, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_team_name ON participants(team_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','participant')),
  participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);

CREATE TABLE IF NOT EXISTS team_join_tokens (
  token TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at BIGINT NOT NULL,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_join_tokens_team ON team_join_tokens(team_id);

CREATE TABLE IF NOT EXISTS team_tokens (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  reward_token TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (team_id, slot)
);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  submitted_answer TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0,1)),
  attempt_number INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_team ON puzzle_attempts(team_id);

CREATE TABLE IF NOT EXISTS final_submissions (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  leader_participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  submission_number INTEGER NOT NULL,
  submitted_sequence TEXT NOT NULL,
  correct_positions INTEGER NOT NULL,
  incorrect_positions INTEGER NOT NULL,
  was_correct INTEGER NOT NULL CHECK (was_correct IN (0,1)),
  created_at BIGINT NOT NULL,
  elapsed_ms BIGINT NOT NULL,
  UNIQUE (team_id, submission_number)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'WAITING' CHECK (state IN ('WAITING','READY','ACTIVE','ENDED')),
  started_at BIGINT,
  ends_at BIGINT,
  ended_at BIGINT,
  duration_sec INTEGER NOT NULL DEFAULT 600,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_results (
  team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  completed_at BIGINT,
  completion_time_ms BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','QUALIFIED','DISQUALIFIED')),
  rank INTEGER,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  team_id INTEGER,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

let driverPromise: Promise<Driver> | null = null;
let isPostgres = false;

async function createDriver(): Promise<Driver> {
  const url = config.databaseUrl;
  if (/^postgres(ql)?:\/\//.test(url)) {
    isPostgres = true;
    return createPgDriver(url);
  }
  isPostgres = false;
  return await createPgliteDriver(url);
}

async function migrate(driver: Driver): Promise<void> {
  const direct = config.directUrl;
  if (isPostgres && direct && direct !== config.databaseUrl) {
    // Supabase recommends running DDL through the session-mode connection.
    const client = new Client({ connectionString: direct, ssl: sslOption(direct) });
    await client.connect();
    try {
      await client.query(SCHEMA);
    } finally {
      await client.end();
    }
    return;
  }
  await driver.exec(SCHEMA);
}

/** The driver for the current request/transaction, initialising on first use. */
async function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = (async () => {
      const driver = await createDriver();
      await migrate(driver);
      return driver;
    })();
  }
  return driverPromise;
}

function currentCtx(driver: Driver): Ctx {
  const store = als.getStore();
  if (store) return store;
  return {
    query: (sql, params) => driver.query(sql, params),
    exec: (sql) => driver.exec(sql),
  };
}

/* ------------------------------------------------------------- statement */

class Statement {
  constructor(private readonly sql: string) {}

  async get(...params: unknown[]): Promise<Row | undefined> {
    const driver = await getDriver();
    const res = await currentCtx(driver).query(this.sql, params);
    return res.rows[0];
  }

  async all(...params: unknown[]): Promise<Row[]> {
    const driver = await getDriver();
    const res = await currentCtx(driver).query(this.sql, params);
    return res.rows;
  }

  async run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
    const driver = await getDriver();
    const res = await currentCtx(driver).query(this.sql, params);
    return { changes: res.rowCount, lastInsertRowid: 0 };
  }
}

/* ------------------------------------------------------------------ db API */

export const db = {
  prepare(sql: string): Statement {
    return new Statement(sql);
  },

  async exec(sql: string): Promise<void> {
    const driver = await getDriver();
    await currentCtx(driver).exec(sql);
  },

  /** Run `fn` inside a single database transaction (BEGIN/COMMIT/ROLLBACK). */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const driver = await getDriver();
    const handle = await driver.beginTx();
    try {
      const result = await als.run(handle.ctx, fn);
      await handle.commit();
      return result;
    } catch (err) {
      await handle.rollback();
      throw err;
    } finally {
      handle.release();
    }
  },

  /** Force initialisation (connect + run migrations) before traffic starts. */
  async init(): Promise<void> {
    await getDriver();
  },

  async close(): Promise<void> {
    if (driverPromise) {
      const driver = await driverPromise;
      await driver.close();
      driverPromise = null;
    }
  },
};

export function nowMs(): number {
  return Date.now();
}

/** Append-only audit trail. Writes are queued so callers stay synchronous. */
let auditChain: Promise<unknown> = Promise.resolve();

export function audit(
  event: string,
  actorType: 'system' | 'admin' | 'participant',
  opts: { actorId?: string | number | null; teamId?: number | null; detail?: unknown } = {},
): void {
  auditChain = auditChain
    .then(() =>
      db
        .prepare(
          `INSERT INTO audit_logs (event, actor_type, actor_id, team_id, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event,
          actorType,
          opts.actorId == null ? null : String(opts.actorId),
          opts.teamId ?? null,
          JSON.stringify(opts.detail ?? {}),
          Date.now(),
        ),
    )
    .catch((err: unknown) => {
      console.error('[endgame] audit write failed:', err instanceof Error ? err.message : err);
    });
}

/** Await pending audit writes (used by seeding and tests for determinism). */
export async function flushAudit(): Promise<void> {
  await auditChain;
}
