import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './helpers.js';
import { normalizePhone } from '../src/phone.js';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

describe('numéros', () => {
  it('normalise', () => {
    expect(normalizePhone('97 00 00 01', 'BJ')).toBe('+2290197000001');
    expect(normalizePhone('0197000001', 'BJ')).toBe('+2290197000001');
    expect(normalizePhone('+229 01 97 00 00 01')).toBe('+2290197000001');
    expect(normalizePhone('0022997000001')).toBe('+2290197000001');
    expect(normalizePhone('07 08 09 10 11', 'CI')).toBe('+2250708091011');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('+22912345')).toBeNull();
  });
});

describe('authentification OTP', () => {
  it('connexion complète, profil, déconnexion', async () => {
    const s = await h.login('97000001');
    const me = await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(s.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ phone: '+2290197000001', role: 'SUBSCRIBER', subscriptionEndsAt: null });

    const patched = await h.app.inject({ method: 'PATCH', url: '/me', headers: h.auth(s.token), payload: { name: 'Ama' } });
    expect(patched.json()).toMatchObject({ name: 'Ama' });

    const out = await h.app.inject({ method: 'POST', url: '/auth/logout', cookies: { mb_refresh: s.cookie } });
    expect(out.statusCode).toBe(200);
    const after = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: s.cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejette un mauvais code puis verrouille après 5 essais, même avec le bon code', async () => {
    const phone = '97000002';
    await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    const good = h.otp.codes.get('+2290197000002') as string;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: bad } });
      expect(r.statusCode).toBe(401);
    }
    const r = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: good } });
    expect(r.statusCode).toBe(401);
  });

  it('un code ne sert qu’une fois', async () => {
    const phone = '97000003';
    await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    const code = h.otp.codes.get('+2290197000003') as string;
    const a = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } });
    const b = await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(401);
  });

  it('limite la fréquence des demandes par numéro (30 s)', async () => {
    const phone = '97000004';
    const a = await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    const b = await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(429);
  });

  it('numéro invalide → 400 ; corps invalide → 400', async () => {
    expect((await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: 'abcdefgh' } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: '97000005', code: '12' } })).statusCode).toBe(400);
  });

  it('rotation du jeton de rafraîchissement et détection de réutilisation', async () => {
    const s = await h.login('97000006');
    const r1 = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: s.cookie } });
    expect(r1.statusCode).toBe(200);
    const newCookie = String(r1.cookies.find((c) => c.name === 'mb_refresh')?.value);
    expect(newCookie).not.toBe(s.cookie);

    // Rejeu de l'ancien jeton hors fenêtre de tolérance → toutes les sessions sont révoquées.
    await h.db.refreshToken.updateMany({ where: { userId: s.userId, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    const replay = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: s.cookie } });
    expect(replay.statusCode).toBe(401);
    const victim = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: newCookie } });
    expect(victim.statusCode).toBe(401);
  });

  it('un double rafraîchissement simultané légitime ne déconnecte personne', async () => {
    const s = await h.login('97000007');
    const r1 = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: s.cookie } });
    const newCookie = String(r1.cookies.find((c) => c.name === 'mb_refresh')?.value);
    const r2 = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: s.cookie } });
    expect(r2.statusCode).toBe(401); // le second onglet doit se réauthentifier…
    const still = await h.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mb_refresh: newCookie } });
    expect(still.statusCode).toBe(200); // …mais la session du premier survit
  });

  it('les numéros ADMIN_PHONES deviennent administrateurs', async () => {
    const s = await h.login('+2290100000099');
    const me = await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(s.token) });
    expect(me.json()).toMatchObject({ role: 'ADMIN' });
  });

  it('routes protégées : 401 sans jeton ou avec un jeton falsifié', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer abc.def.ghi' } })).statusCode).toBe(401);
  });

  it('le code OTP n’est jamais stocké en clair', async () => {
    await h.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '97000008' } });
    const code = h.otp.codes.get('+2290197000008') as string;
    const row = await h.db.otpCode.findFirstOrThrow({ where: { phone: '+2290197000008' } });
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
