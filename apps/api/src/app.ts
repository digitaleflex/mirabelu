import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { BillingError } from '@mirabelu/billing';
import { ProviderError } from '@mirabelu/billing';
import { StorageError } from '@mirabelu/storage';
import { type AppDeps, type Ctx } from './context.js';
import { HttpError, forbidden, unauthorized } from './errors.js';
import { TokenService } from './tokens.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { catalogRoutes } from './routes/catalog.js';
import { libraryRoutes } from './routes/library.js';
import { meRoutes } from './routes/me.js';
import { playbackRoutes } from './routes/playback.js';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Jamais de jetons, cookies ni corps de requête dans les journaux.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
  });

  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const clock = deps.now ?? (() => new Date());

  const ctx: Ctx = {
    ...deps,
    tokens,
    clock,
    async requireAuth(req) {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) throw unauthorized();
      const claims = await tokens.verifyAccess(token);
      if (!claims) throw unauthorized('Session expirée', 'TOKEN_EXPIRED');
      req.auth = { userId: claims.sub, role: claims.role };
    },
    async requireAdmin(req, reply) {
      await ctx.requireAuth(req, reply);
      // Le rôle est relu en base : une révocation d'administrateur prend effet immédiatement.
      const u = await deps.db.user.findUnique({ where: { id: req.auth?.userId ?? '' }, select: { role: true } });
      if (u?.role !== 'ADMIN') throw forbidden('Réservé aux administrateurs');
    },
  };

  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof BillingError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'PROVIDER_DISABLED' ? 400 : err.code === 'FORBIDDEN' ? 403 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ProviderError) {
      req.log.warn({ err: err.message }, 'erreur prestataire de paiement');
      return reply.status(502).send({ error: { code: 'PROVIDER_ERROR', message: 'Le prestataire de paiement est indisponible, réessayez.' } });
    }
    if (err instanceof StorageError) {
      req.log.error({ err: err.message, status: err.status }, 'erreur stockage');
      return reply.status(502).send({ error: { code: 'STORAGE_ERROR', message: 'Le stockage audio est momentanément indisponible.' } });
    }
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes, patientez un instant.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message ?? 'Requête invalide' } });
    }
    req.log.error({ err }, 'erreur interne');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erreur interne' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route inconnue' } }),
  );

  app.get('/health', async () => {
    await deps.db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  await app.register(authRoutes(ctx));
  await app.register(meRoutes(ctx));
  await app.register(catalogRoutes(ctx));
  await app.register(playbackRoutes(ctx));
  await app.register(libraryRoutes(ctx));
  await app.register(billingRoutes(ctx));
  await app.register(adminRoutes(ctx));

  return app;
}
