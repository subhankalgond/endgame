import { config } from './config';

const PING_INTERVAL_MS = 5 * 60_000; // Render spins down after 15 idle minutes.
const PING_TIMEOUT_MS = 20_000;

/**
 * Free hosting (Render starter plan) sleeps an instance after ~15 minutes
 * without inbound traffic, which makes the next page load take 30+ seconds.
 * Ping our own public /api/health endpoint on a timer so the instance is
 * never idle long enough to sleep.
 *
 * The server process can only ping while it is awake, so this is the primary
 * keep-alive; .github/workflows/keep-alive.yml is the secondary one that also
 * covers the gap right after a restart or deploy.
 */
export function startKeepAlive(): void {
  const base = config.keepAliveUrl.trim().replace(/\/+$/, '');
  if (!base) return;

  const url = `${base}/api/health`;
  console.warn(`[endgame] keep-alive active: pinging ${url} every 5 minutes`);

  async function ping(): Promise<void> {
    const startedAt = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      if (res.ok) {
        console.warn(`[endgame] keep-alive: ${res.status} in ${Date.now() - startedAt}ms`);
      } else {
        console.error(`[endgame] keep-alive: unexpected status ${res.status} after ${Date.now() - startedAt}ms`);
      }
    } catch (err: unknown) {
      console.error('[endgame] keep-alive: ping failed:', err);
    }
  }

  const timer = setInterval(() => void ping(), PING_INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the timer
  void ping(); // one ping immediately so a fresh boot warms itself up
}
