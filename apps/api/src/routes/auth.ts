import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { requestOtpBody, verifyOtpBody, type UserDto } from '@mirabelu/contracts';
import { activeSubscription } from '@mirabelu/billing';
import { parse, type Ctx } from '../context.js';
import { badRequest, tooMany, unauthorized } from '../errors.js';
import { hashToken } from '../tokens.js';
import { normalizePhone } from '../phone.js';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MIN_INTERVAL_MS = 30_000;
const OTP_MAX_PER_HOUR = 5;
const REFRESH_COOKIE = 'mb_refresh';
/** Fenêtre pendant laquelle un jeton déjà rotaté est toléré (deux onglets qui rafraîchissent en même temps). */
const REUSE_GRACE_MS = 30_000;

export const authRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, env, tokens, clock } = ctx;

  function setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
  }

  async function issueSession(userId: string, role: 'SUBSCRIBER' | 'ADMIN', userAgent: string | undefined, reply: FastifyReply) {
    const refresh = tokens.newRefreshToken();
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash: refresh.hash,
        expiresAt: new Date(clock().getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
    });
    setRefreshCookie(reply, refresh.token);
    return { accessToken: await tokens.signAccess({ sub: userId, role }), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }

  async function toUserDto(userId: string): Promise<UserDto> {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const sub = await activeSubscription(db, userId, clock());
    return { id: u.id, phone: u.phone, name: u.name, role: u.role, subscriptionEndsAt: sub?.endsAt.toISOString() ?? null };
  }

  app.post('/auth/otp/request', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = parse(requestOtpBody, req.body);
    const phone = normalizePhone(body.phone, env.DEFAULT_PHONE_COUNTRY);
    if (!phone) throw badRequest('Numéro de téléphone invalide', 'INVALID_PHONE');

    const now = clock();
    const recent = await db.otpCode.findMany({
      where: { phone, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < OTP_MIN_INTERVAL_MS) {
      throw tooMany('Un code vient d’être envoyé, patientez 30 secondes.');
    }
    if (recent.length >= OTP_MAX_PER_HOUR) throw tooMany('Trop de demandes, réessayez dans une heure.');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.otpCode.create({
      data: { phone, codeHash: tokens.otpHash(phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
    });
    try {
      await ctx.otp.send(phone, code);
    } catch (e) {
      req.log.error({ err: (e as Error).message }, 'envoi OTP impossible');
      return reply.status(502).send({ error: { code: 'OTP_DELIVERY_FAILED', message: 'Impossible d’envoyer le code, réessayez.' } });
    }
    return { sent: true, phone, expiresInSeconds: OTP_TTL_MS / 1000 };
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = parse(verifyOtpBody, req.body);
    const phone = normalizePhone(body.phone, env.DEFAULT_PHONE_COUNTRY);
    if (!phone) throw badRequest('Numéro de téléphone invalide', 'INVALID_PHONE');

    const now = clock();
    const otp = await db.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw unauthorized('Code invalide ou expiré', 'INVALID_OTP');

    if (!tokens.otpMatches(phone, body.code, otp.codeHash)) {
      await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw unauthorized('Code invalide ou expiré', 'INVALID_OTP');
    }
    // Consommation atomique : un code ne sert qu'une fois, même sous requêtes concurrentes.
    const consumed = await db.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
    if (consumed.count === 0) throw unauthorized('Code invalide ou expiré', 'INVALID_OTP');

    const isAdmin = env.ADMIN_PHONES.includes(phone);
    const user = await db.user.upsert({
      where: { phone },
      create: { phone, role: isAdmin ? 'ADMIN' : 'SUBSCRIBER', lastLoginAt: now },
      update: { lastLoginAt: now, ...(isAdmin ? { role: 'ADMIN' as const } : {}) },
    });
    const session = await issueSession(user.id, user.role, req.headers['user-agent'], reply);
    return { ...session, user: await toUserDto(user.id) };
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw unauthorized('Session absente', 'NO_SESSION');
    const row = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
    const now = clock();
    if (!row || row.expiresAt <= now) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      throw unauthorized('Session expirée', 'SESSION_EXPIRED');
    }
    if (row.revokedAt) {
      // Réutilisation d'un jeton déjà tourné : si ce n'est pas une course légitime, on coupe toutes les sessions.
      if (now.getTime() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
        await db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      }
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      throw unauthorized('Session expirée', 'SESSION_EXPIRED');
    }
    const revoked = await db.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
    if (revoked.count === 0) throw unauthorized('Session expirée', 'SESSION_EXPIRED');

    const session = await issueSession(row.userId, row.user.role, req.headers['user-agent'], reply);
    return { ...session, user: await toUserDto(row.userId) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      await db.refreshToken.updateMany({ where: { tokenHash: hashToken(raw), revokedAt: null }, data: { revokedAt: clock() } });
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { ok: true };
  });
};
