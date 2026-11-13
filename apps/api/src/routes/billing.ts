import type { FastifyPluginAsync } from 'fastify';
import { checkoutBody, confirmPaymentBody, type CheckoutResponse, type PaymentDto } from '@mirabelu/contracts';
import { BillingError, ProviderError, settlePayment, startCheckout, type ProviderCode } from '@mirabelu/billing';
import { authOf, parse, type Ctx } from '../context.js';
import { badRequest, notFound } from '../errors.js';

interface PaymentRow {
  id: string;
  plan: 'QUARTERLY' | 'ANNUAL';
  provider: string;
  amountXof: number;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';
  createdAt: Date;
  paidAt: Date | null;
}

const toPaymentDto = (p: PaymentRow): PaymentDto => ({
  id: p.id,
  plan: p.plan,
  provider: p.provider,
  amountXof: p.amountXof,
  status: p.status,
  createdAt: p.createdAt.toISOString(),
  paidAt: p.paidAt?.toISOString() ?? null,
});

export const billingRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, providers, env, clock } = ctx;

  // --- Parcours utilisateur ---------------------------------------------------
  app.register(async (authed) => {
    authed.addHook('preHandler', ctx.requireAuth);

    authed.get('/billing/payments', async (req) => {
      const rows = await db.payment.findMany({
        where: { userId: authOf(req).userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map(toPaymentDto);
    });

    authed.get('/billing/providers', async () => Object.keys(providers));

    authed.post('/billing/checkout', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req): Promise<CheckoutResponse> => {
      const body = parse(checkoutBody, req.body);
      const out = await startCheckout(db, providers, {
        userId: authOf(req).userId,
        plan: body.plan,
        provider: body.provider,
        returnUrl: `${env.WEB_ORIGIN}/abonnement/retour`,
      });
      if (out.init.kind === 'redirect') return { kind: 'redirect', paymentId: out.paymentId, url: out.init.url };
      if (out.init.kind === 'widget') return { kind: 'widget', paymentId: out.paymentId, widget: out.init.widget };
      return { kind: 'mock', paymentId: out.paymentId };
    });

    /** Statut d'un paiement ; s'il est en attente avec une référence connue, on re-vérifie auprès du prestataire. */
    authed.get<{ Params: { id: string } }>('/billing/payments/:id', async (req) => {
      const userId = authOf(req).userId;
      let p = await db.payment.findFirst({ where: { id: req.params.id, userId } });
      if (!p) throw notFound('Paiement introuvable');
      if (p.status === 'PENDING' && p.providerRef && p.provider !== 'MOCK') {
        try {
          await settlePayment(db, providers, p.id, p.providerRef, clock());
          p = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          req.log.warn({ err: e.message }, 'vérification du paiement différée');
        }
      }
      return toPaymentDto(p);
    });

    /** Confirmation après le widget KKiaPay (transactionId) ou le mode simulé. */
    authed.post<{ Params: { id: string } }>('/billing/payments/:id/confirm', async (req) => {
      const body = parse(confirmPaymentBody, req.body);
      const userId = authOf(req).userId;
      const p = await db.payment.findFirst({ where: { id: req.params.id, userId } });
      if (!p) throw notFound('Paiement introuvable');
      if (p.provider === 'FEDAPAY') throw badRequest('Ce paiement est confirmé automatiquement par le prestataire.');

      const clash = await db.payment.findFirst({
        where: { provider: p.provider, providerRef: body.transactionId, id: { not: p.id } },
        select: { id: true },
      });
      if (clash) throw badRequest('Cette transaction est déjà associée à un autre paiement.', 'TRANSACTION_ALREADY_USED');

      await settlePayment(db, providers, p.id, body.transactionId, clock());
      return toPaymentDto(await db.payment.findUniqueOrThrow({ where: { id: p.id } }));
    });
  });

  // --- Webhooks (non authentifiés, signature vérifiée, corps brut requis) -------
  app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body === '' ? {} : JSON.parse(body as string));
      } catch {
        done(null, {});
      }
    });

    for (const code of ['FEDAPAY', 'KKIAPAY'] as const satisfies readonly ProviderCode[]) {
      hooks.post(`/webhooks/${code.toLowerCase()}`, async (req, reply) => {
        const adapter = providers[code];
        if (!adapter) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Inactif' } });

        const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
        const signal = adapter.parseWebhook(req.headers, raw);
        if (!signal) return reply.status(401).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature invalide' } });

        // Le signal n'est qu'un déclencheur : on retrouve le paiement puis on re-vérifie auprès du prestataire.
        const payment = await db.payment.findFirst({
          where: {
            provider: code,
            OR: [{ providerRef: signal.providerRef }, ...(signal.paymentId ? [{ id: signal.paymentId }] : [])],
          },
        });
        if (!payment) return { received: true, matched: false };

        try {
          await settlePayment(db, providers, payment.id, signal.providerRef, clock());
        } catch (e) {
          if (e instanceof ProviderError && e.retryable) {
            return reply.status(503).send({ error: { code: 'RETRY', message: 'Vérification différée' } });
          }
          if (e instanceof BillingError) {
            req.log.warn({ code: e.code, paymentId: payment.id }, 'webhook paiement ignoré');
            return { received: true, matched: true };
          }
          throw e;
        }
        return { received: true, matched: true };
      });
    }
  });
};
