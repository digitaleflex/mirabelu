import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@mirabelu/database';
import { createTestDatabase, type TestDatabase } from '@mirabelu/database/testing';
import {
  MockProvider, settlePayment, startCheckout, activeSubscription, grantSubscription, BillingError,
  type ProviderRegistry,
} from '../src/index.js';

let tdb: TestDatabase;
let db: Db;
const providers: ProviderRegistry = { MOCK: new MockProvider() };

beforeAll(async () => {
  tdb = await createTestDatabase();
  db = createDb(tdb.url);
});
afterAll(async () => {
  await db.$disconnect();
  await tdb.drop();
});

async function newUser(phone: string) {
  return db.user.create({ data: { phone } });
}

describe('règlement des paiements', () => {
  it('paiement → un seul abonnement même avec 8 confirmations concurrentes', async () => {
    const u = await newUser('+22900000010');
    const { paymentId } = await startCheckout(db, providers, { userId: u.id, plan: 'QUARTERLY', provider: 'MOCK', returnUrl: 'https://app/r' });
    const outs = await Promise.all(Array.from({ length: 8 }, () => settlePayment(db, providers, paymentId, 'mock_ok_1')));
    expect(outs.filter((o) => o.activated)).toHaveLength(1);
    expect(outs.every((o) => o.status === 'PAID')).toBe(true);
    expect(await db.subscription.count({ where: { userId: u.id } })).toBe(1);
    expect(await activeSubscription(db, u.id)).not.toBeNull();
  });

  it('un renouvellement prolonge à partir de la fin de l’abonnement en cours', async () => {
    const u = await newUser('+22900000011');
    const now = new Date('2026-11-11T00:00:00Z');
    const a = await startCheckout(db, providers, { userId: u.id, plan: 'QUARTERLY', provider: 'MOCK', returnUrl: 'x' });
    await settlePayment(db, providers, a.paymentId, 'mock_ok_a', now);
    const b = await startCheckout(db, providers, { userId: u.id, plan: 'ANNUAL', provider: 'MOCK', returnUrl: 'x' });
    await settlePayment(db, providers, b.paymentId, 'mock_ok_b', now);
    const subs = await db.subscription.findMany({ where: { userId: u.id }, orderBy: { startsAt: 'asc' } });
    expect(subs.map((s) => s.endsAt.toISOString())).toEqual(['2027-02-11T00:00:00.000Z', '2028-02-11T00:00:00.000Z']);
    expect(subs[1]?.startsAt.toISOString()).toBe('2027-02-11T00:00:00.000Z');
  });

  it('un refus ne donne aucun abonnement ; un paiement en attente reste en attente', async () => {
    const u = await newUser('+22900000012');
    const a = await startCheckout(db, providers, { userId: u.id, plan: 'QUARTERLY', provider: 'MOCK', returnUrl: 'x' });
    expect((await settlePayment(db, providers, a.paymentId, 'mock_pending')).status).toBe('PENDING');
    expect((await settlePayment(db, providers, a.paymentId, 'mock_fail_1')).status).toBe('FAILED');
    expect(await db.subscription.count({ where: { userId: u.id } })).toBe(0);
  });

  it('un paiement déjà réglé n’est pas réactivé', async () => {
    const u = await newUser('+22900000013');
    const a = await startCheckout(db, providers, { userId: u.id, plan: 'QUARTERLY', provider: 'MOCK', returnUrl: 'x' });
    await settlePayment(db, providers, a.paymentId, 'mock_ok_z');
    const again = await settlePayment(db, providers, a.paymentId, 'mock_ok_z');
    expect(again.activated).toBe(false);
    expect(await db.subscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('moyen de paiement non activé → erreur claire', async () => {
    const u = await newUser('+22900000014');
    await expect(startCheckout(db, providers, { userId: u.id, plan: 'QUARTERLY', provider: 'FEDAPAY', returnUrl: 'x' })).rejects.toBeInstanceOf(BillingError);
  });

  it('octroi manuel', async () => {
    const u = await newUser('+22900000015');
    await grantSubscription(db, { userId: u.id, plan: 'ANNUAL', note: 'partenariat' });
    expect(await activeSubscription(db, u.id)).not.toBeNull();
  });
});
