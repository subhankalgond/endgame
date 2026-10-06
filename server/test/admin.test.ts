import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  adminAgent,
  boot,
  correctSequence,
  fillTeam,
  joinToken,
  leaderIndex,
  startRound,
  type Ctx,
} from './helpers';

let ctx: Ctx;

beforeAll(async () => {
  ctx = await boot();
});

const protectedGets = [
  '/api/admin/me',
  '/api/admin/teams',
  '/api/admin/qr',
  '/api/admin/puzzles',
  '/api/admin/round',
  '/api/admin/live-status',
  '/api/admin/results',
  '/api/admin/logs',
  '/api/admin/submissions',
  '/api/admin/attempts',
];

describe('admin security', () => {
  it('rejects every admin endpoint without authentication', async () => {
    for (const path of protectedGets) {
      const res = await request(ctx.app).get(path);
      expect(res.status, path).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password|stack/i);
    }
    for (const path of ['/api/admin/round/start', '/api/admin/round/end', '/api/admin/round/reset', '/api/admin/qr/regenerate']) {
      const res = await request(ctx.app).post(path).send({});
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects bad credentials and enforces logout', async () => {
    const bad = await request(ctx.app).post('/api/admin/login').send({ username: 'admin', password: 'wrong' });
    expect(bad.status).toBe(401);

    const agent = request.agent(ctx.app);
    const ok = await agent.post('/api/admin/login').send({ username: 'admin', password: 'Test-Password-9271' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/admin/me')).status).toBe(200);
    await agent.post('/api/admin/logout');
    expect((await agent.get('/api/admin/me')).status).toBe(401);
  });

  it('does not let a participant session reach admin APIs', async () => {
    const agents = await fillTeam(ctx, 1, ['Sec A', 'Sec B', 'Sec C', 'Sec D']);
    for (const path of protectedGets) {
      const res = await agents[0].get(path);
      expect(res.status, path).toBe(401);
    }
    const start = await agents[0].post('/api/admin/round/start').send({});
    expect(start.status).toBe(401);
  });

  it('sets hardened response headers and hides framework fingerprints', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('keeps database internals out of participant payloads', async () => {
    const agent = request.agent(ctx.app);
    await agent.post(`/api/join/${await joinToken(ctx.db, 7)}`).send({ name: 'Leak Probe' });
    const res = await agent.get('/api/session');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('scrypt$');
    expect(text).not.toContain('join_token');
    expect(text).not.toContain('joinToken');
    for (let team = 1; team <= 8; team += 1) {
      expect(text).not.toContain(await joinToken(ctx.db, team));
    }
  });

  it('stores injected input as inert text', async () => {
    const before = (await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c;
    const res = await request(ctx.app)
      .post(`/api/join/${await joinToken(ctx.db, 6)}`)
      .send({ name: "Robert'); DROP TABLE participants;--" });
    expect(res.status).toBe(400);
    const after = (await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

describe('admin configuration', () => {
  it('updates team names, rosters and the correct final sequence', async () => {
    const admin = await adminAgent(ctx);
    const teams = await admin.get('/api/admin/teams');
    expect(teams.status).toBe(200);
    expect(teams.body.teams).toHaveLength(8);
    expect(teams.body.teams[0].correctSequence).toEqual(['8x', '7k4', '72', '0a']);

    const rename = await admin.put('/api/admin/teams/5').send({ name: 'Team Five' });
    expect(rename.status).toBe(200);
    const roster = await admin.put('/api/admin/teams/5').send({ roster: ['Alpha', 'Bravo', 'Charlie', 'Delta'] });
    expect(roster.status).toBe(200);
    const after = await admin.get('/api/admin/teams');
    expect(after.body.teams[4].name).toBe('Team Five');
    expect(after.body.teams[4].roster).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);

    const invalid = await admin.put('/api/admin/teams/1/sequence').send({ sequence: ['7k4', '7k4', '8x', '72'] });
    expect(invalid.status).toBe(400);

    const valid = await admin
      .put('/api/admin/teams/1/sequence')
      .send({ sequence: ['72', '8x', '0a', '7k4'] });
    expect(valid.status).toBe(200);
    expect(await correctSequence(ctx.db, 1)).toEqual(['72', '8x', '0a', '7k4']);
    // restore the documented default for the rest of the run
    await admin.put('/api/admin/teams/1/sequence').send({ sequence: ['8x', '7k4', '72', '0a'] });
  });

  it('edits puzzles server-side with alternative accepted answers', async () => {
    const admin = await adminAgent(ctx);
    const list = await admin.get('/api/admin/puzzles');
    expect(list.status).toBe(200);
    expect(list.body.puzzles).toHaveLength(32);

    const puzzle = list.body.puzzles.find((p: { teamId: number; slot: number }) => p.teamId === 3 && p.slot === 1);
    const res = await admin.put(`/api/admin/puzzles/${puzzle.id}`).send({
      question: 'What is 6 x 7?',
      answer: '42',
      altAnswers: ['forty two'],
      rewardToken: 'ZZ9',
      difficulty: 'easy',
      explanation: 'Basic multiplication.',
    });
    expect(res.status).toBe(200);
    const updated = await admin.get('/api/admin/puzzles');
    const found = updated.body.puzzles.find((p: { id: number }) => p.id === puzzle.id);
    expect(found.question).toBe('What is 6 x 7?');
    expect(found.altAnswers).toEqual(['forty two']);
    expect(found.rewardToken).toBe('ZZ9');
    // the team_tokens table used for final-sequence validation follows the edit
    const mirrored = await ctx.db.prepare('SELECT reward_token FROM team_tokens WHERE team_id = 3 AND slot = 1').get() as {
      reward_token: string;
    };
    expect(mirrored.reward_token).toBe('ZZ9');

    const rejected = await admin.put(`/api/admin/puzzles/${puzzle.id}`).send({ question: '' });
    expect(rejected.status).toBe(400);

    // restore the documented token so the rest of the run stays consistent
    await admin.put(`/api/admin/puzzles/${puzzle.id}`).send({
      question: 'What number comes next? 3, 6, 9, 12, ?',
      answer: '15',
      altAnswers: [],
      rewardToken: 'a07',
      difficulty: 'easy',
      explanation: 'Counting in 3s.',
    });
    const restored = await ctx.db.prepare('SELECT reward_token FROM team_tokens WHERE team_id = 3 AND slot = 1').get() as {
      reward_token: string;
    };
    expect(restored.reward_token).toBe('a07');
  });

  it('serves real QR codes and invalidates them on regeneration', async () => {
    const admin = await adminAgent(ctx);
    const res = await admin.get('/api/admin/qr');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(8);
    const urls = res.body.items.map((i: { joinUrl: string }) => i.joinUrl);
    expect(new Set(urls).size).toBe(8);
    for (const item of res.body.items) {
      expect(item.qr).toMatch(/^data:image\/png;base64,/);
      expect(item.joinUrl).toContain('/join/team/');
      const token = await joinToken(ctx.db, item.id);
      expect(item.joinUrl.endsWith(token)).toBe(true);
      expect(token.length).toBeGreaterThanOrEqual(30);
      expect(token).not.toMatch(/^(team|Team)/);
    }

    const oldToken = await joinToken(ctx.db, 4);
    const regen = await admin.post('/api/admin/qr/regenerate').send({ teamId: 4 });
    expect(regen.status).toBe(200);
    expect(regen.body.joinUrl).not.toContain(oldToken);

    const stale = await request(ctx.app).post(`/api/join/${oldToken}`).send({ name: 'Stale Scanner' });
    expect(stale.status).toBe(404);

    // token history: the rotated token is revoked, the new one is active
    const oldRow = await ctx.db.prepare('SELECT active, revoked_at FROM team_join_tokens WHERE token = ?').get(oldToken) as
      | { active: number; revoked_at: number | null }
      | undefined;
    expect(oldRow?.active).toBe(0);
    expect(oldRow?.revoked_at).not.toBeNull();
    const newRow = await ctx.db
      .prepare('SELECT active FROM team_join_tokens WHERE token = ?')
      .get(regen.body.joinUrl.split('/join/team/')[1]) as { active: number } | undefined;
    expect(newRow?.active).toBe(1);

    const freshAgent = request.agent(ctx.app);
    const fresh = await freshAgent.post(`/api/join/${regen.body.joinUrl.split('/join/team/')[1]}`).send({
      name: 'Fresh Scanner',
    });
    expect(fresh.status).toBe(201);
    expect(fresh.body.team.id).toBe(4);
    await ctx.db.prepare('DELETE FROM participants WHERE name = ?').run('Fresh Scanner');
  });

  it('keeps team_tokens and active join tokens consistent for the whole event', async () => {
    const rows = await ctx.db
      .prepare(
        `SELECT p.team_id, p.slot, p.reward_token AS puzzle_token, t.reward_token AS team_token
         FROM puzzles p JOIN team_tokens t ON t.team_id = p.team_id AND t.slot = p.slot`,
      )
      .all() as { team_id: number; slot: number; puzzle_token: string; team_token: string }[];
    expect(rows).toHaveLength(32);
    for (const row of rows) expect(row.team_token).toBe(row.puzzle_token);

    const active = await ctx.db.prepare('SELECT COUNT(*) AS c FROM team_join_tokens WHERE active = 1').get() as {
      c: number;
    };
    expect(active.c).toBe(8);
    const withTeam = await ctx.db.prepare('SELECT COUNT(DISTINCT team_id) AS c FROM team_join_tokens WHERE active = 1').get() as {
      c: number;
    };
    expect(withTeam.c).toBe(8);

    // every team's configured correct sequence is a permutation of its own tokens
    const teams = await ctx.db.prepare('SELECT id, correct_sequence FROM teams ORDER BY id').all() as {
      id: number;
      correct_sequence: string;
    }[];
    for (const team of teams) {
      const tokens = await ctx.db
        .prepare('SELECT reward_token FROM team_tokens WHERE team_id = ? ORDER BY slot')
        .all(team.id) as { reward_token: string }[];
      const sequence = JSON.parse(team.correct_sequence) as string[];
      expect([...sequence].sort()).toEqual(tokens.map((t) => t.reward_token).sort());
    }
  });
});

describe('round control, ranking and reset', () => {
  it('prepares and starts the round using only server-side timing', async () => {
    const admin = await adminAgent(ctx);
    const prepared = await admin.post('/api/admin/round/prepare').send({});
    expect(prepared.status).toBe(200);
    expect(prepared.body.round.state).toBe('READY');

    const started = await admin
      .post('/api/admin/round/start')
      .send({ startedAt: 1, endsAt: 2, remainingTime: 999999 });
    expect(started.status).toBe(200);
    expect(started.body.round.startedAt).toBeGreaterThan(Date.now() - 5000);
    expect(started.body.round.endsAt).toBe(started.body.round.startedAt + 600_000);
    expect(started.body.round.startedAt).not.toBe(1);

    const again = await admin.post('/api/admin/round/start').send({});
    expect(again.status).toBe(409);
  });

  it('locks gameplay while active results stay hidden', async () => {
    const agent = request.agent(ctx.app);
    await agent.post(`/api/join/${await joinToken(ctx.db, 6)}`).send({ name: 'Result Watcher' });
    const res = await agent.get('/api/results');
    expect(res.status).toBe(409);
  });

  it('runs the full 32-player field and ranks by real completion time', async () => {
    // teams 1-4 complete; teams 5-8 finish partially (team 5 already renamed)
    const plan: { teamId: number; names: string[]; solve: number }[] = [
      { teamId: 1, names: ['T1 A', 'T1 B', 'T1 C', 'T1 D'], solve: 4 },
      { teamId: 2, names: ['T2 A', 'T2 B', 'T2 C', 'T2 D'], solve: 4 },
      { teamId: 3, names: ['T3 A', 'T3 B', 'T3 C', 'T3 D'], solve: 4 },
      { teamId: 4, names: ['T4 A', 'T4 B', 'T4 C', 'T4 D'], solve: 4 },
      { teamId: 5, names: ['T5 A', 'T5 B', 'T5 C', 'T5 D'], solve: 3 },
      { teamId: 6, names: ['T6 A', 'T6 B', 'T6 C', 'T6 D'], solve: 1 },
      { teamId: 7, names: ['T7 A', 'T7 B', 'T7 C', 'T7 D'], solve: 0 },
      { teamId: 8, names: ['T8 A', 'T8 B', 'T8 C', 'T8 D'], solve: 0 },
    ];

    // start from a clean field so exactly 32 participants join
    await ctx.db.prepare('DELETE FROM participants').run();
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c).toBe(0);

    for (const entry of plan) {
      const agents = await fillTeam(ctx, entry.teamId, entry.names);
      for (let slot = 1; slot <= entry.solve; slot += 1) {
        const answer = (await ctx.db.prepare('SELECT answer FROM puzzles WHERE team_id = ? AND slot = ?').get(
          entry.teamId,
          slot,
        ) as { answer: string }).answer;
        const res = await agents[slot - 1].post('/api/puzzle/submit').send({ answer });
        expect(res.status, `team ${entry.teamId} slot ${slot}`).toBe(200);
        expect(res.body.correct).toBe(true);
      }
      if (entry.solve === 4) {
        const leader = agents[await leaderIndex(ctx.db, entry.teamId)];
        const res = await leader
          .post('/api/team/final-submit')
          .send({ sequence: await correctSequence(ctx.db, entry.teamId) });
        expect(res.status).toBe(200);
        expect(res.body.completed).toBe(true);
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    const joined = (await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c;
    expect(joined).toBe(32);

    const live = await (await adminAgent(ctx)).get('/api/admin/live-status');
    expect(live.status).toBe(200);
    expect(live.body.participants).toBe(joined);
    expect(live.body.readyTeams).toBe(8);
    const completed = live.body.teams.filter((t: { status: string }) => t.status === 'COMPLETED');
    expect(completed).toHaveLength(4);
  });

  it('ends the round, qualifies the top four and eliminates the rest', async () => {
    const admin = await adminAgent(ctx);
    const res = await admin.post('/api/admin/round/end').send({});
    expect(res.status).toBe(200);
    expect(res.body.round.state).toBe('ENDED');

    const results = res.body.results as {
      rank: number;
      teamId: number;
      completed: boolean;
      completionTimeMs: number | null;
      status: string;
      puzzlesSolved: number;
    }[];
    expect(results).toHaveLength(8);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const qualified = results.filter((r) => r.status === 'QUALIFIED');
    const eliminated = results.filter((r) => r.status === 'DISQUALIFIED');
    expect(qualified).toHaveLength(4);
    expect(eliminated).toHaveLength(4);
    expect(qualified.map((r) => r.teamId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(qualified.every((r) => r.completed && r.completionTimeMs != null)).toBe(true);
    for (let i = 1; i < qualified.length; i += 1) {
      expect(qualified[i].completionTimeMs!).toBeGreaterThanOrEqual(qualified[i - 1].completionTimeMs!);
    }
    expect(eliminated.map((r) => r.teamId).sort((a, b) => a - b)).toEqual([5, 6, 7, 8]);
    expect(results.find((r) => r.teamId === 5)!.puzzlesSolved).toBe(3);
    expect(results.find((r) => r.teamId === 6)!.puzzlesSolved).toBe(1);

    // participants can read the standings once the round ends
    const agent = request.agent(ctx.app);
    await agent.post(`/api/join/${await joinToken(ctx.db, 2)}`).send({ name: 'T2 A' });
    const shown = await agent.get('/api/results');
    expect(shown.status).toBe(200);
    expect(shown.body.results).toHaveLength(8);
    expect(shown.body.results[0].status).toBe('QUALIFIED');
    expect(shown.body.results[0].completionTimeMs).not.toBeNull();

    const afterEnd = await admin.post('/api/admin/round/start').send({});
    expect(afterEnd.status).toBe(409);
  });

  it('records audit events for the whole run', async () => {
    const admin = await adminAgent(ctx);
    const logs = await admin.get('/api/admin/logs');
    expect(logs.status).toBe(200);
    const events = new Set(logs.body.logs.map((l: { event: string }) => l.event));
    for (const expected of [
      'participant_joined',
      'leader_selected',
      'puzzles_assigned',
      'puzzle_solved',
      'final_sequence_submitted',
      'team_completed',
      'round_started',
      'round_ended',
      'qr_regenerated',
      'puzzle_updated',
      'admin_team_updated',
      'admin_login',
    ]) {
      expect(events, expected).toContain(expected);
    }
  });

  it('resets the round only with confirmation and preserves configuration', async () => {
    const admin = await adminAgent(ctx);

    const noConfirm = await admin.post('/api/admin/round/reset').send({});
    expect(noConfirm.status).toBe(400);
    const stillThere = (await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c;
    expect(stillThere).toBeGreaterThan(0);

    const ok = await admin.post('/api/admin/round/reset').send({ confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.round.state).toBe('WAITING');
    expect(ok.body.round.startedAt).toBeNull();
    expect(ok.body.round.endsAt).toBeNull();

    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants').get() as { c: number }).c).toBe(0);
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM puzzle_attempts').get() as { c: number }).c).toBe(0);
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM final_submissions').get() as { c: number }).c).toBe(0);

    // configuration survives
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c).toBe(8);
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM puzzles').get() as { c: number }).c).toBe(32);
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM admins').get() as { c: number }).c).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c).toBeGreaterThan(0);
    const result = await ctx.db.prepare('SELECT status, rank FROM team_results WHERE team_id = 1').get() as {
      status: string;
      rank: number | null;
    };
    expect(result.status).toBe('PENDING');
    expect(result.rank).toBeNull();

    // participant sessions from before the reset are dead
    const stale = request.agent(ctx.app);
    await stale.post(`/api/join/${await joinToken(ctx.db, 1)}`).send({ name: 'Post Reset' });
    const sessionBefore = await stale.get('/api/session');
    expect(sessionBefore.status).toBe(200);
    await admin.post('/api/admin/round/reset').send({ confirm: true });
    const sessionAfter = await stale.get('/api/session');
    expect(sessionAfter.status).toBe(401);
  });

  it('reopens the round for a fresh run after reset', async () => {
    const started = await startRound(ctx);
    const status = await started.get('/api/admin/round');
    expect(status.body.round.state).toBe('ACTIVE');
    expect(status.body.round.startedAt).toBeGreaterThan(0);
  });
});
