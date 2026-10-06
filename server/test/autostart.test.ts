process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'Test-Password-9271';

import { beforeAll, describe, expect, it } from 'vitest';
import { fillTeam, boot, type Ctx } from './helpers';

let ctx: Ctx;

beforeAll(async () => {
  ctx = await boot();
});

describe('round auto-start', () => {
  it('is disabled in the test environment by default', async () => {
    const { config } = await import('../src/config.js');
    expect(config.autoStartRound).toBe(false);
  });

  it('does nothing while no team is complete', async () => {
    await fillTeam(ctx, 2, ['Auto A', 'Auto B', 'Auto C', 'Auto D']);
    const { maybeAutoStartRound } = await import('../src/game.js');
    // 1/8 teams ready, but the 20s grace window has not elapsed yet
    expect(await maybeAutoStartRound(true)).toBe(false);
    const round = await ctx.db.prepare('SELECT state FROM rounds WHERE id = 1').get() as { state: string };
    expect(['WAITING', 'READY']).toContain(round.state);
  });

  it('starts for everyone after the grace window once the first team fills up', async () => {
    await fillTeam(ctx, 3, ['Auto E', 'Auto F', 'Auto G', 'Auto H']);
    const { maybeAutoStartRound } = await import('../src/game.js');
    // Backdate every join past the 20s grace window.
    await ctx.db.prepare('UPDATE participants SET joined_at = joined_at - 60_000').run();
    expect(await maybeAutoStartRound(true)).toBe(true);
    const round = await ctx.db.prepare('SELECT state FROM rounds WHERE id = 1').get() as { state: string };
    expect(round.state).toBe('ACTIVE');
    // Put the round back so the all-teams scenario can be exercised too.
    await ctx.db
      .prepare("UPDATE rounds SET state = 'WAITING', started_at = NULL, ends_at = NULL, ended_at = NULL WHERE id = 1")
      .run();
  });

  it('starts immediately when every team has all four players', async () => {
    for (const teamId of [1, 4, 5, 6, 7, 8]) {
      await fillTeam(ctx, teamId, [`T${teamId} A`, `T${teamId} B`, `T${teamId} C`, `T${teamId} D`]);
    }
    const { maybeAutoStartRound } = await import('../src/game.js');
    expect(await maybeAutoStartRound(true)).toBe(true);
    const round = await ctx.db.prepare('SELECT state, started_at, ends_at FROM rounds WHERE id = 1').get() as {
      state: string;
      started_at: number | null;
      ends_at: number | null;
    };
    expect(round.state).toBe('ACTIVE');
    expect(round.started_at).not.toBeNull();
    expect(round.ends_at).not.toBeNull();

    // Each start is audited and a running round is never started twice.
    const { flushAudit } = await import('../src/db.js');
    await flushAudit();
    const auditRow = await ctx.db
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE event = 'round_auto_started'")
      .get() as { c: number };
    expect(auditRow.c).toBe(2);
    expect(await maybeAutoStartRound(true)).toBe(false);
  });
});
