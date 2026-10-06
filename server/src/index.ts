import { createServer } from 'node:http';
import { createSocketServer } from './socket';
import { createApp } from './app';
import { config } from './config';
import { purgeExpiredSessions } from './lib/session';
import { refreshRound } from './game';

const app = createApp();
const server = createServer(app);
const io = createSocketServer(server);

const tick = setInterval(() => {
  try {
    refreshRound();
  } catch (err) {
    console.error('[endgame] round tick failed:', err);
  }
}, 1000);
tick.unref();

const sessionSweep = setInterval(() => purgeExpiredSessions(), 5 * 60_000);
sessionSweep.unref();

server.listen(config.port, () => {
  console.warn(`[endgame] server listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  clearInterval(tick);
  clearInterval(sessionSweep);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
