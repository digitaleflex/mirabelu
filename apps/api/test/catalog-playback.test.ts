import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantSubscription } from '@mirabelu/billing';
import { createHarness, seedPublishedBook, type Harness } from './helpers.js';

let h: Harness;
let bookId: string;
beforeAll(async () => {
  h = await createHarness();
  bookId = (await seedPublishedBook(h)).id;
  await seedPublishedBook(h, { slug: 'brouillon', title: 'Brouillon', publish: false });
  const cat = await h.db.category.findFirstOrThrow();
  const author = await h.db.author.findFirstOrThrow();
  // Publié mais droits non vérifiés : ne doit jamais apparaître.
  await h.db.book.create({ data: { slug: 'sans-droits', title: 'Sans droits', authorId: author.id, categoryId: cat.id, status: 'PUBLISHED', rightsStatus: 'UNVERIFIED', publishedAt: new Date() } });
});
afterAll(async () => { await h.close(); });

describe('catalogue', () => {
  it('n’expose que les livres publiés ET aux droits vérifiés', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/catalog/books' });
    const body = r.json() as { items: { slug: string }[]; total: number };
    expect(body.items.map((b) => b.slug)).toEqual(['atomic-habits']);
    expect(body.total).toBe(1);
    expect((await h.app.inject({ method: 'GET', url: '/catalog/books/brouillon' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/catalog/books/sans-droits' })).statusCode).toBe(404);
  });

  it('recherche par titre et par auteur, insensible à la casse', async () => {
    const byTitle = (await h.app.inject({ method: 'GET', url: '/catalog/books?q=ATOMIC' })).json() as { total: number };
    const byAuthor = (await h.app.inject({ method: 'GET', url: '/catalog/books?q=clear' })).json() as { total: number };
    const none = (await h.app.inject({ method: 'GET', url: '/catalog/books?q=zzz' })).json() as { total: number };
    expect([byTitle.total, byAuthor.total, none.total]).toEqual([1, 1, 0]);
  });

  it('accueil, catégories, détail anonyme', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/catalog/home' })).statusCode).toBe(200);
    const cats = (await h.app.inject({ method: 'GET', url: '/catalog/categories' })).json() as unknown[];
    expect(cats).toHaveLength(1);
    const d = (await h.app.inject({ method: 'GET', url: '/catalog/books/atomic-habits' })).json() as { canListen: boolean; chapters: unknown[]; hasEssentials: boolean };
    expect(d.canListen).toBe(false);
    expect(d.chapters).toHaveLength(1);
    expect(d.hasEssentials).toBe(true);
  });

  it('les résumés exigent un abonnement', async () => {
    const s = await h.login('98000001');
    expect((await h.app.inject({ method: 'GET', url: '/catalog/books/atomic-habits/essentials', headers: h.auth(s.token) })).statusCode).toBe(403);
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    const ok = await h.app.inject({ method: 'GET', url: '/catalog/books/atomic-habits/essentials', headers: h.auth(s.token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ understandMd: '## Comprendre', applyMd: '## Appliquer' });
  });
});

describe('lecture', () => {
  it('refuse sans abonnement, accepte avec', async () => {
    const s = await h.login('98000002');
    const no = await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) });
    expect(no.statusCode).toBe(403);
    expect(no.json()).toMatchObject({ error: { code: 'SUBSCRIPTION_REQUIRED' } });

    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    const ok = await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ contentType: 'audio/mp4', durationSec: 3600, resumeAtSec: 0 });
  });

  it('refuse sans authentification', async () => {
    expect((await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url` })).statusCode).toBe(401);
  });

  it('met en cache l’URL par (utilisateur, livre) : un seul preview-intent AURA', async () => {
    const s = await h.login('98000003');
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    const before = h.storage.previewCalls;
    const calls = await Promise.all(Array.from({ length: 6 }, () => h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) })));
    const urls = new Set(calls.map((c) => (c.json() as { url: string }).url));
    expect(urls.size).toBe(1);
    expect(h.storage.previewCalls - before).toBe(1);

    // Un autre utilisateur n'hérite JAMAIS de l'URL d'un autre (capacité au porteur).
    const other = await h.login('98000004');
    await grantSubscription(h.db, { userId: other.userId, plan: 'QUARTERLY', note: 'test' });
    const o = (await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(other.token) })).json() as { url: string };
    expect(urls.has(o.url)).toBe(false);
  });

  it('renouvelle l’URL quand il lui reste trop peu de temps', async () => {
    const s = await h.login('98000005');
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    h.storage.ttl = 60; // l'URL expire dans 60 s < marge minimale → jamais réutilisée
    const a = (await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) })).json() as { url: string };
    const b = (await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) })).json() as { url: string };
    h.storage.ttl = 900;
    expect(a.url).not.toBe(b.url);
  });

  it('reprend là où l’utilisateur s’était arrêté', async () => {
    const s = await h.login('98000006');
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(s.token), payload: { positionSec: 1234, listenedSec: 60 } });
    const r = (await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) })).json() as { resumeAtSec: number };
    expect(r.resumeAtSec).toBe(1234);
  });

  it('un abonnement expiré ne donne plus accès', async () => {
    const s = await h.login('98000007');
    await h.db.subscription.create({ data: { userId: s.userId, plan: 'QUARTERLY', startsAt: new Date(Date.now() - 200 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000) } });
    expect((await h.app.inject({ method: 'POST', url: `/playback/${bookId}/url`, headers: h.auth(s.token) })).statusCode).toBe(403);
  });

  it('restrictions territoriales', async () => {
    const restricted = await seedPublishedBook(h, { slug: 'ci-seulement', title: 'CI seulement', territories: ['CI'] });
    const s = await h.login('98000008'); // Bénin
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    const r = await h.app.inject({ method: 'POST', url: `/playback/${restricted.id}/url`, headers: h.auth(s.token) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'TERRITORY_RESTRICTED' } });
  });

  it('livre dépublié ou droits retirés → indisponible', async () => {
    const b = await seedPublishedBook(h, { slug: 'retire', title: 'Retiré' });
    const s = await h.login('98000009');
    await grantSubscription(h.db, { userId: s.userId, plan: 'QUARTERLY', note: 'test' });
    await h.db.book.update({ where: { id: b.id }, data: { rightsStatus: 'UNVERIFIED' } });
    expect((await h.app.inject({ method: 'POST', url: `/playback/${b.id}/url`, headers: h.auth(s.token) })).statusCode).toBe(404);
  });
});
