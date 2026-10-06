import { createServer } from 'node:http';
import { createSocketServer } from './socket';
import { createApp } from './app';
import { config } from './config';
import { purgeExpiredSessions } from './lib/session';
import { maybeAutoStartRound, refreshRound } from './game';
import { startKeepAlive } from './keepalive';

async function main(): Promise<void> {
  const app = await createApp();
  const server = createServer(app);
  const io = createSocketServer(server);

  const tick = setInterval(() => {
    void (async () => {
      await refreshRound();
      // Auto-start once every team is complete so nobody waits on a stuck lobby.
      await maybeAutoStartRound();
    })().catch((err: unknown) => {
      console.error('[endgame] round tick failed:', err);
    });
  }, 1000);
  tick.unref();

  const sessionSweep = setInterval(() => {
    void purgeExpiredSessions().catch((err: unknown) => {
      console.error('[endgame] session sweep failed:', err);
    });
  }, 5 * 60_000);
  sessionSweep.unref();

  server.listen(config.port, () => {
    console.warn(`[endgame] server listening on http://localhost:${config.port}`);
  });

  startKeepAlive();

  function shutdown(): void {
    clearInterval(tick);
    clearInterval(sessionSweep);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[endgame] failed to start:', err);
  process.exit(1);
});
