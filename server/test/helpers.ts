process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'Test-Password-9271';
process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_URL = 'http://localhost:5173';

import type { Express } from 'express';
import request from 'supertest';

export interface Ctx {
  app: Express;
  tokens: Record<number, string[]>;
  db: typeof import('../src/db').db;
}

export async function boot(): Promise<Ctx> {
  const appModule = await import('../src/app');
  const dbModule = await import('../src/db');
  const seedModule = await import('../src/seed');
  const app = await appModule.createApp();
  return { app, tokens: seedModule.TEAM_TOKENS, db: dbModule.db };
}

export type Agent = ReturnType<typeof request.agent>;

export async function joinToken(db: Ctx['db'], teamId: number): Promise<string> {
  const row = await db.prepare('SELECT join_token FROM teams WHERE id = ?').get(teamId) as { join_token: string };
  return row.join_token;
}

export async function join(ctx: Ctx, teamId: number, name: string): Promise<Agent> {
  const agent = request.agent(ctx.app);
  const res = await agent.post(`/api/join/${await joinToken(ctx.db, teamId)}`).send({ name });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function adminAgent(ctx: Ctx): Promise<Agent> {
  const agent = request.agent(ctx.app);
  const res = await agent.post('/api/admin/login').send({ username: 'admin', password: 'Test-Password-9271' });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return agent;
}

export async function fillTeam(ctx: Ctx, teamId: number, names: string[]): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const name of names) {
    agents.push(await join(ctx, teamId, name));
  }
  return agents;
}

export async function leaderIndex(db: Ctx['db'], teamId: number): Promise<number> {
  const row = await db.prepare('SELECT slot FROM participants WHERE team_id = ? AND is_leader = 1').get(teamId) as
    | { slot: number }
    | undefined;
  if (!row) throw new Error('no leader selected');
  return row.slot - 1;
}

export async function correctSequence(db: Ctx['db'], teamId: number): Promise<string[]> {
  const row = await db.prepare('SELECT correct_sequence FROM teams WHERE id = ?').get(teamId) as {
    correct_sequence: string;
  };
  return JSON.parse(row.correct_sequence) as string[];
}

export async function puzzleAnswer(db: Ctx['db'], teamId: number, slot: number): Promise<string> {
  const row = await db.prepare('SELECT answer FROM puzzles WHERE team_id = ? AND slot = ?').get(teamId, slot) as {
    answer: string;
  };
  return row.answer;
}

export async function rewardToken(db: Ctx['db'], teamId: number, slot: number): Promise<string> {
  const row = await db.prepare('SELECT reward_token FROM puzzles WHERE team_id = ? AND slot = ?').get(teamId, slot) as {
    reward_token: string;
  };
  return row.reward_token;
}

/** Solve all four puzzles for a team using the real API (skips players who already solved). */
export async function solveTeam(ctx: Ctx, agents: Agent[]): Promise<void> {
  for (let i = 0; i < agents.length; i += 1) {
    const status = await agents[i].get('/api/my-puzzle');
    if (status.status !== 200) throw new Error(`my-puzzle failed: ${status.status}`);
    if (status.body.puzzle?.solved) continue;
    const teamId = await teamIdOf(agents[i]);
    const res = await agents[i]
      .post('/api/puzzle/submit')
      .send({ answer: await puzzleAnswer(ctx.db, teamId, i + 1) });
    if (res.status !== 200 || !res.body.correct) {
      throw new Error(`solve failed for slot ${i + 1}: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
}

export async function teamIdOf(agent: Agent): Promise<number> {
  const res = await agent.get('/api/session');
  if (res.status !== 200) throw new Error(`session failed: ${res.status}`);
  return (res.body as { team: { id: number } }).team.id;
}

export async function startRound(ctx: Ctx): Promise<Agent> {
  const admin = await adminAgent(ctx);
  const prepare = await admin.post('/api/admin/round/prepare');
  if (prepare.status !== 200) throw new Error(`prepare failed: ${prepare.status}`);
  const res = await admin.post('/api/admin/round/start');
  if (res.status !== 200) throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return admin;
}
