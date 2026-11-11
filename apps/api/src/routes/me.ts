import type { FastifyPluginAsync } from 'fastify';
import { updateProfileBody, type UserDto } from '@mirabelu/contracts';
import { activeSubscription, PLANS } from '@mirabelu/billing';
import { authOf, parse, type Ctx } from '../context.js';

export const meRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, clock } = ctx;

  async function dto(userId: string): Promise<UserDto> {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const sub = await activeSubscription(db, userId, clock());
    return { id: u.id, phone: u.phone, name: u.name, role: u.role, subscriptionEndsAt: sub?.endsAt.toISOString() ?? null };
  }

  app.get('/me', { preHandler: ctx.requireAuth }, async (req) => dto(authOf(req).userId));

  app.patch('/me', { preHandler: ctx.requireAuth }, async (req) => {
    const body = parse(updateProfileBody, req.body);
    await db.user.update({ where: { id: authOf(req).userId }, data: { name: body.name } });
    return dto(authOf(req).userId);
  });

  app.get('/plans', async () =>
    Object.values(PLANS).map((p) => ({
      code: p.code,
      label: p.label,
      priceXof: p.priceXof,
      durationMonths: p.durationMonths,
      monthlyXof: Math.round(p.priceXof / p.durationMonths),
    })),
  );
};
