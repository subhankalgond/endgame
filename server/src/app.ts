import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config';
import { db } from './db';
import { errorHandler, notFoundHandler } from './middleware';
import { participantRouter } from './routes/participant';
import { adminRouter } from './routes/admin';
import { seedDatabase } from './seed';
import { startRateLimitSweeper } from './lib/rateLimit';
import { requestOrigin } from './lib/origin';

export async function createApp(): Promise<express.Express> {
  await db.init();
  await seedDatabase();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

  // Strict allow-list: configured app origins plus the deployment's own
  // origin (derived per request), so the API stays closed to unknown sites
  // while working unchanged on localhost, Vercel or Render.
  const corsStatics = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  };
  app.use((req, res, next) => {
    const allowed = [config.frontendUrl, config.backendUrl, config.publicBaseUrl]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\/$/, ''));
    const own = requestOrigin(req);
    if (!allowed.includes(own)) allowed.push(own);
    cors({ ...corsStatics, origin: allowed })(req, res, next);
  });

  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600 * config.rateLimitFactor,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests.', code: 'rate_limited' },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, serverTime: Date.now() });
  });

  app.use('/api/admin', adminRouter);
  app.use('/api', participantRouter);

  // Serve the built client in production (single-origin deployment).
  const distDir = resolve(__dirname, '../../client/dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h', etag: true }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(resolve(distDir, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  startRateLimitSweeper().unref();

  return app;
}
