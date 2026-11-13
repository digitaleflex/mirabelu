import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncAdmins } from '../src/admins.js';
import { createHarness, seedPublishedBook, type Harness } from './helpers.js';

let h: Harness;
let admin: { token: string; userId: string };
beforeAll(async () => {
  h = await createHarness({ OTP_MAX_PER_HOUR_GLOBAL: '1000', OTP_MAX_PER_HOUR_PER_PREFIX: '1000', METRICS_TOKEN: 'metrics-token-1234567' });
  admin = await h.login('+2290100000099');
});
afterAll(async () => { await h.close(); });

const post = (url: string, payload: unknown, token = admin.token) => h.app.inject({ method: 'POST', url, headers: h.auth(token), payload: payload as object });

describe('suspension de compte', () => {
  it('coupe l’accès tout de suite, révoque les sessions et bloque la reconnexion ; la levée rétablit', async () => {
    const u = await h.login('93000001');
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(u.token) })).statusCode).toBe(200);

    expect((await post(`/admin/users/${u.userId}/suspend`, { reason: 'fraude avérée' })).statusCode).toBe(200);

    const me = await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(u.token) });
    expect(me.statusCode).toBe(403);
    expect((me.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_SUSPENDED');
    const refresh = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: u.cookie } });
    expect(refresh.statusCode).toBe(401); // session révoquée

    await expect(h.login('93000001')).rejects.toThrow(/403/);

    expect((await post(`/admin/users/${u.userId}/unsuspend`, {})).statusCode).toBe(200);
    expect((await h.login('93000001')).userId).toBe(u.userId);
  });

  it('refuse de suspendre soi-même ou un administrateur ; réservé aux admins', async () => {
    expect((await post(`/admin/users/${admin.userId}/suspend`, { reason: 'test ok' })).statusCode).toBe(400);
    const other = await h.login('93000002');
    expect((await post(`/admin/users/${other.userId}/suspend`, { reason: 'test ok' }, other.token)).statusCode).toBe(403);
    await h.db.user.update({ where: { id: other.userId }, data: { role: 'ADMIN' } });
    expect((await post(`/admin/users/${other.userId}/suspend`, { reason: 'test ok' })).statusCode).toBe(400);
  });
});

describe('remboursement et annulation', () => {
  it('rembourser un paiement réglé annule l’abonnement lié, une seule fois, et coupe l’écoute', async () => {
    const u = await h.login('93000010');
    await seedPublishedBook(h, { slug: 'refund-book', title: 'Livre remboursement' });
    const bookId = (await h.db.book.findUniqueOrThrow({ where: { slug: 'refund-book' } })).id;

    const co = (await h.app.inject({ method: 'POST', url: '/billing/checkout', headers: h.auth(u.token), payload: { plan: 'QUARTERLY', provider: 'MOCK' } })).json() as { paymentId: string };
    const paid = await h.app.inject({ method: 'POST', url: `/billing/payments/${co.paymentId}/confirm`, headers: h.auth(u.token), payload: { transactionId: 'mock_ok_refund1' } });
    expect((paid.json() as { status: string }).status).toBe('PAID');
    expect((await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(u.token) })).statusCode).toBe(200);

    const r = await post(`/admin/payments/${co.paymentId}/refund`, { reason: 'demande client' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, canceledSubscriptions: 1 });
    expect((await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(u.token) })).statusCode).toBe(403);

    expect((await post(`/admin/payments/${co.paymentId}/refund`, { reason: 'encore' })).statusCode).toBe(409);
    // Un nouveau signal du prestataire ne réactive pas un paiement remboursé.
    const again = await h.app.inject({ method: 'POST', url: `/billing/payments/${co.paymentId}/confirm`, headers: h.auth(u.token), payload: { transactionId: 'mock_ok_refund1' } });
    expect((again.json() as { status: string }).status).toBe('REFUNDED');
    expect(await h.db.subscription.count({ where: { userId: u.userId, status: 'ACTIVE' } })).toBe(0);
  });

  it('annulation manuelle d’un abonnement', async () => {
    const u = await h.login('93000011');
    const g = (await post(`/admin/users/${u.userId}/grant`, { plan: 'QUARTERLY', reason: 'geste commercial' })).json() as { id: string };
    expect((await post(`/admin/subscriptions/${g.id}/cancel`, { reason: 'abus constaté' })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(u.token) })).json()).toMatchObject({ subscriptionEndsAt: null });
    expect((await post(`/admin/subscriptions/${g.id}/cancel`, { reason: 'deuxième fois' })).statusCode).toBe(404);
  });
});

describe('administrateurs', () => {
  it('syncAdmins rétrograde un admin retiré d’ADMIN_PHONES et révoque ses sessions', async () => {
    const x = await h.login('93000020');
    await h.db.user.update({ where: { id: x.userId }, data: { role: 'ADMIN' } });
    expect(await syncAdmins(h.db, h.env)).toBeGreaterThanOrEqual(1);
    expect((await h.db.user.findUniqueOrThrow({ where: { id: x.userId } })).role).toBe('SUBSCRIBER');
    expect(await h.db.refreshToken.count({ where: { userId: x.userId, revokedAt: null } })).toBe(0);
    // L'administrateur configuré, lui, reste admin.
    expect((await h.db.user.findUniqueOrThrow({ where: { id: admin.userId } })).role).toBe('ADMIN');
    expect(await syncAdmins(h.db, h.env)).toBe(0);
  });
});

describe('plafonds anti-fraude SMS', () => {
  it('refuse les envois au-delà du plafond global', async () => {
    const strict = await createHarness({ OTP_MAX_PER_HOUR_GLOBAL: '2' });
    try {
      for (const phone of ['94000001', '94000002']) {
        expect((await strict.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } })).statusCode).toBe(200);
      }
      const r = await strict.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '94000003' } });
      expect(r.statusCode).toBe(429);
    } finally {
      await strict.close();
    }
  });

  it('refuse les envois au-delà du plafond par préfixe pays', async () => {
    const strict = await createHarness({ OTP_MAX_PER_HOUR_PER_PREFIX: '1' });
    try {
      expect((await strict.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '95000001' } })).statusCode).toBe(200);
      expect((await strict.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '95000002' } })).statusCode).toBe(429);
      // Un autre pays n'est pas touché.
      expect((await strict.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+22507070707' } })).statusCode).toBe(200);
    } finally {
      await strict.close();
    }
  });
});

describe('couverture et statistiques', () => {
  it('n’accepte qu’une couverture https', async () => {
    const cat = await h.db.category.findFirstOrThrow();
    const base = { title: 'Couv', authorName: 'Auteur', categorySlug: cat.slug };
    expect((await post('/admin/books', { ...base, coverUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await post('/admin/books', { ...base, coverUrl: 'http://exemple.org/c.jpg' })).statusCode).toBe(400);
    expect((await post('/admin/books', { ...base, coverUrl: 'https://exemple.org/c.jpg' })).statusCode).toBe(201);
  });

  it('plafonne le temps d’écoute déclaré à 24 h par jour et par utilisateur', async () => {
    const u = await h.login('93000030');
    await post(`/admin/users/${u.userId}/grant`, { plan: 'QUARTERLY', reason: 'test écoute' });
    await seedPublishedBook(h, { slug: 'listen-cap', title: 'Plafond' });
    const bookId = (await h.db.book.findUniqueOrThrow({ where: { slug: 'listen-cap' } })).id;
    for (let i = 0; i < 30; i++) {
      await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(u.token), payload: { positionSec: 10, listenedSec: 3600 } });
    }
    const sum = await h.db.listenEvent.aggregate({ where: { userId: u.userId }, _sum: { seconds: true } });
    expect(sum._sum.seconds).toBe(86_400);
  });
});

describe('métriques', () => {
  it('exige le jeton et expose les compteurs', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const ok = await h.app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer metrics-token-1234567' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('mirabelu_http_requests_total');
    expect(ok.body).toContain('mirabelu_active_subscriptions');
  });
});
