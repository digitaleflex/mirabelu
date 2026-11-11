import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, remote, signFeda, FEDA_WEBHOOK_SECRET, KKIA_WEBHOOK_SECRET, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const hasSub = async (userId: string) => (await h.db.subscription.count({ where: { userId } })) > 0;

describe('plans', () => {
  it('liste les formules', async () => {
    const plans = (await h.app.inject({ method: 'GET', url: '/plans' })).json() as { code: string; priceXof: number; monthlyXof: number }[];
    expect(plans).toEqual([
      { code: 'QUARTERLY', label: 'Trimestrielle', priceXof: 7500, durationMonths: 3, monthlyXof: 2500 },
      { code: 'ANNUAL', label: 'Annuelle', priceXof: 25000, durationMonths: 12, monthlyXof: 2083 },
    ]);
  });
});

describe('KKiaPay (widget + confirmation serveur)', () => {
  it('checkout → widget, confirmation vérifiée côté serveur → abonnement', async () => {
    const s = await h.login('95000001');
    const c = await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } });
    expect(c.statusCode).toBe(200);
    const co = c.json() as { kind: string; paymentId: string; widget: { amount: number; partnerId: string; publicKey: string } };
    expect(co.kind).toBe('widget');
    expect(co.widget).toMatchObject({ amount: 7500, partnerId: co.paymentId, publicKey: 'pk' });

    // Le client prétend avoir payé sans que KKiaPay le confirme → rien.
    const fake = await h.app.inject({ method: 'POST', url: `/billing/payments/${co.paymentId}/confirm`, headers: h.auth(s.token), payload: { transactionId: 'T-inconnue' } });
    expect(fake.json()).toMatchObject({ status: 'FAILED' });
    expect(await hasSub(s.userId)).toBe(false);
  });

  it('transaction réelle → payée ; elle ne peut pas servir deux fois', async () => {
    const s = await h.login('95000002');
    const mk = async () => (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    const p1 = await mk();
    remote.kkia.set('T-ok', { status: 'SUCCESS', amount: 7500, partnerId: p1.paymentId });
    const ok = await h.app.inject({ method: 'POST', url: `/billing/payments/${p1.paymentId}/confirm`, headers: h.auth(s.token), payload: { transactionId: 'T-ok' } });
    expect(ok.json()).toMatchObject({ status: 'PAID' });
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);

    // Rejouer la même transaction sur un second paiement : refusé.
    const p2 = await mk();
    const replay = await h.app.inject({ method: 'POST', url: `/billing/payments/${p2.paymentId}/confirm`, headers: h.auth(s.token), payload: { transactionId: 'T-ok' } });
    expect(replay.statusCode).toBe(400);
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);
  });

  it('montant trop faible (transaction à 100 F utilisée pour 7 500 F) → refusé', async () => {
    const s = await h.login('95000003');
    const p = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    remote.kkia.set('T-cheap', { status: 'SUCCESS', amount: 100, partnerId: p.paymentId });
    const r = await h.app.inject({ method: 'POST', url: `/billing/payments/${p.paymentId}/confirm`, headers: h.auth(s.token), payload: { transactionId: 'T-cheap' } });
    expect(r.json()).toMatchObject({ status: 'FAILED' });
    expect(await hasSub(s.userId)).toBe(false);
  });

  it('transaction d’un autre utilisateur (partnerId différent) → refusé', async () => {
    const a = await h.login('95000004');
    const b = await h.login('95000005');
    const pa = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(a.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    const pb = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(b.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    remote.kkia.set('T-a', { status: 'SUCCESS', amount: 7500, partnerId: pa.paymentId });
    const r = await h.app.inject({ method: 'POST', url: `/billing/payments/${pb.paymentId}/confirm`, headers: h.auth(b.token), payload: { transactionId: 'T-a' } });
    expect(r.json()).toMatchObject({ status: 'FAILED' });
    expect(await hasSub(b.userId)).toBe(false);
  });

  it('on ne peut pas confirmer le paiement d’un autre utilisateur', async () => {
    const a = await h.login('95000006');
    const b = await h.login('95000007');
    const pa = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(a.token), payload: { plan: 'QUARTERLY', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    const r = await h.app.inject({ method: 'POST', url: `/billing/payments/${pa.paymentId}/confirm`, headers: h.auth(b.token), payload: { transactionId: 'x' } });
    expect(r.statusCode).toBe(404);
  });

  it('webhook KKiaPay : secret requis ; sert seulement de déclencheur de re-vérification', async () => {
    const s = await h.login('95000008');
    const p = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'ANNUAL', provider: 'KKIAPAY' } })).json() as { paymentId: string };
    const body = JSON.stringify({ transactionId: 'T-hook', partnerId: p.paymentId });

    expect((await h.app.inject({ method: 'POST', url: '/webhooks/kkiapay', headers: { 'content-type': 'application/json' }, payload: body })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/webhooks/kkiapay', headers: { 'content-type': 'application/json', 'x-kkiapay-secret': 'faux' }, payload: body })).statusCode).toBe(401);

    // Secret correct mais KKiaPay ne connaît pas la transaction → pas d'abonnement.
    const unverified = await h.app.inject({ method: 'POST', url: '/webhooks/kkiapay', headers: { 'content-type': 'application/json', 'x-kkiapay-secret': KKIA_WEBHOOK_SECRET }, payload: body });
    expect(unverified.statusCode).toBe(200);
    expect(await hasSub(s.userId)).toBe(false);

    remote.kkia.set('T-hook', { status: 'SUCCESS', amount: 25000, partnerId: p.paymentId });
    await h.app.inject({ method: 'POST', url: '/webhooks/kkiapay', headers: { 'content-type': 'application/json', 'x-kkiapay-secret': KKIA_WEBHOOK_SECRET }, payload: body });
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);
    // Webhook rejoué : toujours un seul abonnement.
    await h.app.inject({ method: 'POST', url: '/webhooks/kkiapay', headers: { 'content-type': 'application/json', 'x-kkiapay-secret': KKIA_WEBHOOK_SECRET }, payload: body });
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);
  });
});

describe('FedaPay (redirection + webhook signé)', () => {
  it('checkout → redirection ; webhook signé → paiement re-vérifié → abonnement', async () => {
    const s = await h.login('94000001');
    const c = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'FEDAPAY' } })).json() as { kind: string; url: string; paymentId: string };
    expect(c).toMatchObject({ kind: 'redirect', url: 'https://pay.fedapay.test/checkout' });
    const pay = await h.db.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(pay.providerRef).toBeTruthy();

    const body = JSON.stringify({ name: 'transaction.approved', entity: { id: Number(pay.providerRef), custom_metadata: { paymentId: c.paymentId } } });

    // Signature invalide → 401 ; corps modifié → 401
    expect((await h.app.inject({ method: 'POST', url: '/webhooks/fedapay', headers: { 'content-type': 'application/json', 'x-fedapay-signature': signFeda(body, 'mauvais') }, payload: body })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/webhooks/fedapay', headers: { 'content-type': 'application/json', 'x-fedapay-signature': signFeda(body) }, payload: body + ' ' })).statusCode).toBe(401);

    // Signature valide mais FedaPay dit « pending » → toujours rien.
    await h.app.inject({ method: 'POST', url: '/webhooks/fedapay', headers: { 'content-type': 'application/json', 'x-fedapay-signature': signFeda(body) }, payload: body });
    expect(await hasSub(s.userId)).toBe(false);

    // FedaPay approuve réellement.
    const tx = remote.feda.get(pay.providerRef as string);
    if (tx) tx.status = 'approved';
    const ok = await h.app.inject({ method: 'POST', url: '/webhooks/fedapay', headers: { 'content-type': 'application/json', 'x-fedapay-signature': signFeda(body) }, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);
    expect((await h.app.inject({ method: 'GET', url: `/billing/payments/${c.paymentId}`, headers: h.auth(s.token) })).json()).toMatchObject({ status: 'PAID' });
  });

  it('au retour du navigateur, GET du paiement re-vérifie auprès de FedaPay', async () => {
    const s = await h.login('94000002');
    const c = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'FEDAPAY' } })).json() as { paymentId: string };
    const pay = await h.db.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect((await h.app.inject({ method: 'GET', url: `/billing/payments/${c.paymentId}`, headers: h.auth(s.token) })).json()).toMatchObject({ status: 'PENDING' });
    const tx = remote.feda.get(pay.providerRef as string);
    if (tx) tx.status = 'approved';
    expect((await h.app.inject({ method: 'GET', url: `/billing/payments/${c.paymentId}`, headers: h.auth(s.token) })).json()).toMatchObject({ status: 'PAID' });
    expect(await h.db.subscription.count({ where: { userId: s.userId } })).toBe(1);
  });

  it('le secret du webhook n’est jamais celui d’un autre prestataire', async () => {
    const body = JSON.stringify({ name: 'transaction.approved', entity: { id: 1 } });
    expect(FEDA_WEBHOOK_SECRET).not.toBe(KKIA_WEBHOOK_SECRET);
    expect((await h.app.inject({ method: 'POST', url: '/webhooks/fedapay', headers: { 'content-type': 'application/json', 'x-kkiapay-secret': KKIA_WEBHOOK_SECRET }, payload: body })).statusCode).toBe(401);
  });
});

describe('mode simulé et divers', () => {
  it('MOCK : confirmation simulée', async () => {
    const s = await h.login('93000001');
    const c = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'ANNUAL', provider: 'MOCK' } })).json() as { kind: string; paymentId: string };
    expect(c.kind).toBe('mock');
    const r = await h.app.inject({ method: 'POST', url: `/billing/payments/${c.paymentId}/confirm`, headers: h.auth(s.token), payload: { transactionId: 'mock_ok_1' } });
    expect(r.json()).toMatchObject({ status: 'PAID' });
    const me = (await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(s.token) })).json() as { subscriptionEndsAt: string };
    expect(new Date(me.subscriptionEndsAt).getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
  });

  it('historique des paiements', async () => {
    const s = await h.login('93000002');
    await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(s.token), payload: { plan: 'QUARTERLY', provider: 'MOCK' } });
    const list = (await h.app.inject({ method: 'GET', url: '/billing/payments', headers: h.auth(s.token) })).json() as unknown[];
    expect(list).toHaveLength(1);
  });
});
