import 'dotenv/config';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return '';
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', './data/pg'),
  /** Optional session-mode connection (e.g. Supabase DIRECT_URL) used for migrations. */
  directUrl: process.env.DIRECT_URL ?? '',
  frontendUrl: env('FRONTEND_URL', 'http://localhost:5173'),
  backendUrl: env('BACKEND_URL', 'http://localhost:4000'),
  // Explicit PUBLIC_BASE_URL wins (pinned domain for printed QRs). When it is
  // unset in production the QR/join URLs are derived per-request from the host
  // the admin panel is served from, so scans work on any deployment out of the box.
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? (nodeEnv === 'production' ? '' : 'http://localhost:5173'),
  sessionTtlHours: Number(env('SESSION_TTL_HOURS', '12')),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', ''),
  roundDurationSec: Number(env('ROUND_DURATION_SEC', '600')),
  trustProxy: env('TRUST_PROXY', '0') === '1',
  // Round 1 starts by itself once every seeded team has all four players, so a
  // complete event can never sit stuck on the waiting screen. Set
  // AUTO_START_ROUND=0 to require the admin "Start round" button instead.
  autoStartRound: env('AUTO_START_ROUND', nodeEnv === 'production' ? '1' : '0') === '1',
  // Seconds a team stays in the ready state before its round countdown begins.
  // Gives the last player a moment to land on their screen; 0 = start instantly.
  autoStartGraceSec: Number(env('AUTO_START_GRACE_SEC', '20')),
  // Public origin pinged every 5 minutes so free hosting (Render) never sleeps.
  // Empty outside production; override with KEEP_ALIVE_URL when the public URL differs.
  keepAliveUrl: process.env.KEEP_ALIVE_URL ?? (nodeEnv === 'production' ? 'https://endgame-bf02.onrender.com' : ''),
  /** Rate limits are relaxed only for automated tests so fixtures are not throttled. */
  rateLimitFactor: nodeEnv === 'test' ? 1000 : 1,
};
