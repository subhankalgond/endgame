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
  databaseUrl: env('DATABASE_URL', './data/endgame.db'),
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
  /** Rate limits are relaxed only for automated tests so fixtures are not throttled. */
  rateLimitFactor: nodeEnv === 'test' ? 1000 : 1,
};
