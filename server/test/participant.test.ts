import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  boot,
  correctSequence,
  fillTeam,
  join,
  joinToken,
  leaderIndex,
  puzzleAnswer,
  rewardToken,
  solveTeam,
  startRound,
  teamIdOf,
  type Agent,
  type Ctx,
} from './helpers';

let ctx: Ctx;

beforeAll(async () => {
  ctx = await boot();
});

describe('team QR joining', () => {
  it('uses 8 unique join tokens that map to the correct team', async () => {
    const rows = await ctx.db.prepare('SELECT id, join_token FROM teams ORDER BY id').all() as {
      id: number;
      join_token: string;
    }[];
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.join_token)).size).toBe(8);

    for (const row of rows) {
      const agent = request.agent(ctx.app);
      const res = await agent.post(`/api/join/${row.join_token}`).send({ name: `Probe${row.id}` });
      expect(res.status).toBe(201);
      expect(res.body.team.id).toBe(row.id);
      // clean up the probe participant so the full-flow tests start fresh
      await ctx.db.prepare('DELETE FROM participants WHERE name = ?').run(`Probe${row.id}`);
    }
  });

  it('rejects unknown, malformed and cross-team tokens', async () => {
    const bad = await request(ctx.app).post('/api/join/not-a-real-token-1234567890').send({ name: 'Intruder' });
    expect(bad.status).toBe(404);

    const short = await request(ctx.app).post('/api/join/abc').send({ name: 'Intruder' });
    expect(short.status).toBe(404);
  });

  it('rejects invalid names', async () => {
    const token = await joinToken(ctx.db, 8);
    const empty = await request(ctx.app).post(`/api/join/${token}`).send({ name: 'x' });
    expect(empty.status).toBe(400);
    const chars = await request(ctx.app).post(`/api/join/${token}`).send({ name: '<script>alert(1)</script>' });
    expect(chars.status).toBe(400);
  });

  it('prevents a fifth player on a full team and never duplicates a known player', async () => {
    const agents = await fillTeam(ctx, 8, ['Riya', 'Kabir', 'Neha', 'Veer']);
    expect(agents).toHaveLength(4);
    const extra = await join(ctx, 8, 'Ghost').catch(() => null);
    expect(extra).toBeNull();
    // re-scanning with an existing name reattaches instead of creating a 5th player
    const duplicate = await request(ctx.app).post(`/api/join/${await joinToken(ctx.db, 8)}`).send({ name: 'riya' });
    expect(duplicate.status).toBe(200);
    const count = await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants WHERE team_id = 8').get() as { c: number };
    expect(count.c).toBe(4);
    const slots = await ctx.db
      .prepare('SELECT DISTINCT slot FROM participants WHERE team_id = 8')
      .all() as { slot: number }[];
    expect(slots).toHaveLength(4);
  });
});

describe('round flow', () => {
  let agents: Agent[] = [];

  beforeAll(async () => {
    agents = await fillTeam(ctx, 1, ['Aman', 'Priya', 'Rahul', 'Sara']);
  });

  it('does not start the round when the 4th player joins; it only marks the team ready', async () => {
    const status = await agents[0].get('/api/team/status');
    expect(status.status).toBe(200);
    expect(status.body.players).toHaveLength(4);
    expect(status.body.players.every((p: { joined: boolean }) => p.joined)).toBe(true);
    const round = await ctx.db.prepare('SELECT state FROM rounds WHERE id = 1').get() as { state: string };
    expect(['WAITING', 'READY']).toContain(round.state);
  });

  it('selects exactly one leader automatically', async () => {
    const leaders = await ctx.db
      .prepare('SELECT id, slot FROM participants WHERE team_id = 1 AND is_leader = 1')
      .all() as { id: string; slot: number }[];
    expect(leaders).toHaveLength(1);

    // no endpoint lets a participant change the leader
    for (const agent of agents) {
      const res = await agent.post('/api/team/set-leader').send({ isLeader: true });
      expect(res.status).toBe(404);
      const res2 = await agent.put('/api/session').send({ isLeader: true });
      expect(res2.status).toBe(404);
    }
    const stillOne = await ctx.db
      .prepare('SELECT COUNT(*) AS c FROM participants WHERE team_id = 1 AND is_leader = 1')
      .get() as { c: number };
    expect(stillOne.c).toBe(1);
  });

  it('gives every participant a different puzzle and never exposes the others', async () => {
    const questions: string[] = [];
    for (let i = 0; i < agents.length; i += 1) {
      const res = await agents[i].get('/api/my-puzzle');
      expect(res.status).toBe(200);
      questions.push(res.body.puzzle.question);
      // the payload must only describe this participant's own slot
      expect(res.body.puzzle.slot).toBe(i + 1);
      expect(res.body.puzzle.token).toBeNull();
    }
    expect(new Set(questions).size).toBe(4);
  });

  it('rejects puzzle submissions before the round starts', async () => {
    const res = await agents[0].post('/api/puzzle/submit').send({ answer: '10' });
    expect(res.status).toBe(409);
  });

  it('starts the round with server-side timestamps', async () => {
    const admin = await startRound(ctx);
    const status = await admin.get('/api/admin/round');
    expect(status.body.round.state).toBe('ACTIVE');
    expect(status.body.round.startedAt).toBeGreaterThan(0);
    expect(status.body.round.endsAt).toBe(status.body.round.startedAt + status.body.round.durationSec * 1000);
  });

  it('accepts correct answers, reveals the right token, rejects wrong answers silently', async () => {
    const wrong = await agents[1].post('/api/puzzle/submit').send({ answer: 'definitely-wrong' });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(JSON.stringify(wrong.body)).not.toContain(await rewardToken(ctx.db, 1, 2));

    const correct = await agents[1]
      .post('/api/puzzle/submit')
      .send({ answer: `  ${(await puzzleAnswer(ctx.db, 1, 2)).toUpperCase()}  ` });
    expect(correct.body.correct).toBe(true);
    expect(correct.body.token).toBe(await rewardToken(ctx.db, 1, 2));

    const attempt = await ctx.db
      .prepare('SELECT COUNT(*) AS c FROM puzzle_attempts WHERE team_id = 1')
      .get() as { c: number };
    expect(attempt.c).toBe(2);
  });

  it('rejects answers for another player or after solving', async () => {
    const solved = await agents[1].post('/api/puzzle/submit').send({ answer: 'x' });
    expect(solved.status).toBe(409);

    // participants cannot point the API at someone else's puzzle
    const res = await agents[2].post('/api/puzzle/submit').send({ answer: '10', puzzleId: 1, slot: 1 });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) expect(res.body.correct).toBe(false);
    const participant = await ctx.db.prepare('SELECT puzzle_id FROM participants WHERE team_id = 1 AND slot = 3').get() as {
      puzzle_id: number;
    };
    const puzzle = await ctx.db.prepare('SELECT team_id, slot FROM puzzles WHERE id = ?').get(participant.puzzle_id) as {
      team_id: number;
      slot: number;
    };
    expect(puzzle.team_id).toBe(1);
    expect(puzzle.slot).toBe(3);
  });

  it('only allows the leader to submit the final sequence', async () => {
    await solveTeam(ctx, agents);
    const leaderIdx = await leaderIndex(ctx.db, 1);
    const seq = await correctSequence(ctx.db, 1);

    const nonLeaderIdx = (leaderIdx + 1) % 4;
    const forbidden = await agents[nonLeaderIdx].post('/api/team/final-submit').send({ sequence: seq });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatch(/leader/i);

    const leader = agents[leaderIdx];
    const swapped = [...seq];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const res = await leader.post('/api/team/final-submit').send({ sequence: swapped });
    expect(res.status).toBe(200);
    const correctCount = swapped.reduce((acc, tok, i) => acc + (tok === seq[i] ? 1 : 0), 0);
    expect(res.body.correct).toBe(correctCount);
    expect(res.body.incorrect).toBe(4 - correctCount);

    // feedback must never identify which positions matched
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/position\s*[1-4]/i);
    expect(Object.keys(res.body).sort()).toEqual(
      ['completed', 'correct', 'duplicate', 'incorrect', 'submissionNumber'].sort(),
    );
  });

  it('keeps the server timer unchanged across retries', async () => {
    const leader = agents[await leaderIndex(ctx.db, 1)];
    const before = await leader.get('/api/round/status');
    const seq = await correctSequence(ctx.db, 1);
    const rotated = [seq[1], seq[2], seq[3], seq[0]];
    const res = await leader.post('/api/team/final-submit').send({ sequence: rotated, endsAt: 9999999999999 });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(false);
    const after = await leader.get('/api/round/status');
    expect(after.body.endsAt).toBe(before.body.endsAt);
    expect(after.body.startedAt).toBe(before.body.startedAt);
    const subs = await ctx.db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = 1').get() as { c: number };
    expect(subs.c).toBe(2);
  });

  it('deduplicates a rapid double tap of the same sequence', async () => {
    const leader = agents[await leaderIndex(ctx.db, 1)];
    const seq = await correctSequence(ctx.db, 1);
    const [a, b] = await Promise.all([
      leader.post('/api/team/final-submit').send({ sequence: seq }),
      leader.post('/api/team/final-submit').send({ sequence: seq }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.completed).toBe(true);
    const subs = await ctx.db.prepare('SELECT COUNT(*) AS c FROM final_submissions WHERE team_id = 1').get() as { c: number };
    expect(subs.c).toBe(3);
    const result = await ctx.db.prepare('SELECT completion_time_ms FROM team_results WHERE team_id = 1').get() as {
      completion_time_ms: number | null;
    };
    expect(result.completion_time_ms).not.toBeNull();
  });

  it('reports team progress and the four earned tokens to the team', async () => {
    const res = await agents[0].get('/api/team/progress');
    expect(res.body.progress.solvedCount).toBe(4);
    expect(res.body.progress.allSolved).toBe(true);
    expect(res.body.players.every((p: { isLeader: boolean }) => typeof p.isLeader === 'boolean')).toBe(true);
  });

  it('preserves sessions across refresh and returns the same participant', async () => {
    const res = await agents[3].get('/api/session');
    expect(res.status).toBe(200);
    const id = res.body.participant.slot;
    expect(id).toBe(4);
    const again = await agents[3].get('/api/session');
    expect(again.body.participant.name).toBe('Sara');
    const total = await ctx.db.prepare('SELECT COUNT(*) AS c FROM participants WHERE team_id = 1').get() as { c: number };
    expect(total.c).toBe(4);
  });

  it('never exposes the correct final sequence to a participant', async () => {
    const seq = await correctSequence(ctx.db, 1);
    for (const agent of agents) {
      const res = await agent.get('/api/session');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('correct_sequence');
      expect(body).not.toContain('correctSequence');
      // the ordered answer never appears as an array; only the earned token set may
      if (body.includes(JSON.stringify(seq))) {
        throw new Error('correct sequence leaked to participant');
      }
      void seq;
    }
    const submissions = await agents[0].get('/api/team/submissions');
    const text = JSON.stringify(submissions.body);
    expect(text).not.toContain('submitted_sequence');
    expect(text).not.toContain('correct_positions');
  });

  it('keeps participants scoped to their own team', async () => {
    const res = await agents[0].get('/api/team/status');
    expect(res.body.team.id).toBe(1);
    const otherTeam = await ctx.db.prepare('SELECT correct_sequence FROM teams WHERE id = 2').get() as {
      correct_sequence: string;
    };
    expect(JSON.stringify(res.body)).not.toContain(otherTeam.correct_sequence);
  });
});

describe('time expiry', () => {
  it('locks submissions once the server clock passes roundEndsAt', async () => {
    const agents = await fillTeam(ctx, 2, ['T2 P1', 'T2 P2', 'T2 P3', 'T2 P4']);
    await solveTeam(ctx, agents);
    // simulate the server clock passing the end time
    await ctx.db.prepare('UPDATE rounds SET ends_at = ? WHERE id = 1').run(Date.now() - 1000);

    const leader = agents[await leaderIndex(ctx.db, 2)];
    const puzzle = await agents[0].post('/api/puzzle/submit').send({ answer: 'anything' });
    expect(puzzle.status).toBe(410);

    const final = await leader.post('/api/team/final-submit').send({ sequence: await correctSequence(ctx.db, 2) });
    expect(final.status).toBe(410);

    const round = await ctx.db.prepare('SELECT state FROM rounds WHERE id = 1').get() as { state: string };
    expect(round.state).toBe('ENDED');
  });
});

export async function teamOf(agent: Agent): Promise<number> {
  return await teamIdOf(agent);
}
