import type { Db } from '@mirabelu/database';
import { addMonths, getPlan, type PlanCode } from './plans.js';
import type { CheckoutInit, ProviderCode, VerifyResult } from './types.js';
import type { ProviderRegistry } from './registry.js';

export class BillingError extends Error {
  constructor(
    message: string,
    readonly code: 'PROVIDER_DISABLED' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' = 'CONFLICT',
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface StartCheckoutInput {
  userId: string;
  plan: PlanCode;
  provider: ProviderCode;
  returnUrl: string;
}

export interface StartCheckoutOutput {
  paymentId: string;
  init: CheckoutInit;
}

export async function startCheckout(db: Db, providers: ProviderRegistry, input: StartCheckoutInput): Promise<StartCheckoutOutput> {
  const adapter = providers[input.provider];
  if (!adapter) throw new BillingError(`Moyen de paiement indisponible : ${input.provider}`, 'PROVIDER_DISABLED');
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new BillingError('Utilisateur introuvable', 'NOT_FOUND');

  const plan = getPlan(input.plan);
  const payment = await db.payment.create({
    data: { userId: user.id, plan: plan.code, amountXof: plan.priceXof, provider: input.provider },
  });
  try {
    const init = await adapter.createCheckout({
      paymentId: payment.id,
      plan: plan.code,
      amountXof: plan.priceXof,
      user: { phone: user.phone, name: user.name },
      returnUrl: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}paymentId=${payment.id}`,
    });
    if (init.kind === 'redirect' && init.providerRef) {
      await db.payment.update({ where: { id: payment.id }, data: { providerRef: init.providerRef } });
    }
    return { paymentId: payment.id, init };
  } catch (e) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: 'création de la transaction impossible' },
    });
    throw e;
  }
}

export interface SettleOutcome {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED';
  /** true si CET appel a activé l'abonnement. */
  activated: boolean;
}

/**
 * Re-vérifie auprès du prestataire puis applique le résultat, de façon idempotente :
 * webhook + retour navigateur + sondage peuvent arriver en même temps sans double abonnement.
 */
export async function settlePayment(
  db: Db,
  providers: ProviderRegistry,
  paymentId: string,
  providerRef: string,
  now: Date = new Date(),
): Promise<SettleOutcome> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new BillingError('Paiement introuvable', 'NOT_FOUND');
  const adapter = providers[payment.provider as ProviderCode];
  if (!adapter) throw new BillingError(`Moyen de paiement indisponible : ${payment.provider}`, 'PROVIDER_DISABLED');
  if (payment.status === 'PAID') return { paymentId, status: 'PAID', activated: false };
  if (payment.providerRef && payment.providerRef !== providerRef) {
    throw new BillingError('Référence de transaction non concordante', 'CONFLICT');
  }

  const result = await adapter.verify(providerRef, { paymentId: payment.id, amountXof: payment.amountXof });
  return applyResult(db, paymentId, result, now);
}

export async function applyResult(db: Db, paymentId: string, result: VerifyResult, now: Date = new Date()): Promise<SettleOutcome> {
  if (result.status === 'PENDING') {
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return { paymentId, status: p.status, activated: false };
  }

  if (result.status !== 'PAID') {
    await db.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: result.status, failureReason: result.reason ?? null },
    });
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return { paymentId, status: p.status, activated: false };
  }

  return db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ['PENDING', 'FAILED', 'CANCELED'] } },
      data: { status: 'PAID', paidAt: now, providerRef: result.providerRef, failureReason: null },
    });
    if (claimed.count === 0) return { paymentId, status: 'PAID' as const, activated: false };

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const plan = getPlan(payment.plan);
    const current = await tx.subscription.findFirst({
      where: { userId: payment.userId, status: 'ACTIVE', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
    });
    const startsAt = current ? current.endsAt : now;
    await tx.subscription.create({
      data: {
        userId: payment.userId,
        plan: plan.code,
        startsAt,
        endsAt: addMonths(startsAt, plan.durationMonths),
        paymentId: payment.id,
      },
    });
    return { paymentId, status: 'PAID' as const, activated: true };
  });
}

/** Abonnement actif à l'instant `now`, s'il existe. */
export async function activeSubscription(db: Db, userId: string, now: Date = new Date()) {
  return db.subscription.findFirst({
    where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
  });
}

/** Octroi manuel (geste commercial, paiement hors ligne) — journalisé via `note`. */
export async function grantSubscription(
  db: Db,
  input: { userId: string; plan: PlanCode; note: string },
  now: Date = new Date(),
) {
  const plan = getPlan(input.plan);
  const current = await db.subscription.findFirst({
    where: { userId: input.userId, status: 'ACTIVE', endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
  });
  const startsAt = current ? current.endsAt : now;
  return db.subscription.create({
    data: {
      userId: input.userId,
      plan: plan.code,
      startsAt,
      endsAt: addMonths(startsAt, plan.durationMonths),
      note: input.note,
    },
  });
}
