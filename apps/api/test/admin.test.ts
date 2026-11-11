import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, seedPublishedBook, type Harness } from './helpers.js';
import { isSafeRelativePath } from '../src/routes/admin.js';

let h: Harness;
let admin: { token: string; userId: string };
let user: { token: string; userId: string };
beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('+2290100000099');
  user = await h.login('92000001');
});
afterAll(async () => { await h.close(); });

const post = (url: string, payload: unknown, token = admin.token) => h.app.inject({ method: 'POST', url, headers: h.auth(token), payload: payload as object });
const put = (url: string, payload: unknown, token = admin.token) => h.app.inject({ method: 'PUT', url, headers: h.auth(token), payload: payload as object });

describe('contrôle d’accès', () => {
  it('un abonné ordinaire est refusé partout dans /admin', async () => {
    for (const url of ['/admin/books', '/admin/categories', '/admin/imports', '/admin/users', '/admin/stats']) {
      expect((await h.app.inject({ method: 'GET', url, headers: h.auth(user.token) })).statusCode).toBe(403);
      expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('la révocation du rôle admin prend effet immédiatement, même avec un jeton encore valide', async () => {
    const tmp = await h.login('92000002');
    await h.db.user.update({ where: { id: tmp.userId }, data: { role: 'ADMIN' } });
    const t = await h.login('92000002'); // jeton portant role=ADMIN
    expect((await h.app.inject({ method: 'GET', url: '/admin/stats', headers: h.auth(t.token) })).statusCode).toBe(200);
    await h.db.user.update({ where: { id: tmp.userId }, data: { role: 'SUBSCRIBER' } });
    expect((await h.app.inject({ method: 'GET', url: '/admin/stats', headers: h.auth(t.token) })).statusCode).toBe(403);
  });
});

describe('catalogue éditorial', () => {
  it('création, droits, publication conditionnelle', async () => {
    const cat = await h.db.category.findFirstOrThrow();
    const created = await post('/admin/books', { title: 'Père riche, père pauvre', authorName: 'Robert Kiyosaki', categorySlug: cat.slug });
    expect(created.statusCode).toBe(201);
    const { id, slug } = created.json() as { id: string; slug: string };
    expect(slug).toBe('pere-riche-pere-pauvre');

    // Doublon de titre → slug suffixé
    const dup = (await post('/admin/books', { title: 'Père riche, père pauvre', authorName: 'Robert Kiyosaki', categorySlug: cat.slug })).json() as { slug: string };
    expect(dup.slug).toBe('pere-riche-pere-pauvre-2');

    // Publication impossible : droits non vérifiés et aucun audio
    const blocked = await post(`/admin/books/${id}/publish`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'NOT_PUBLISHABLE' } });
    expect((blocked.json() as { error: { message: string } }).error.message).toMatch(/droits/);
    expect((blocked.json() as { error: { message: string } }).error.message).toMatch(/audio/);

    // Droits vérifiés mais toujours pas d'audio
    await put(`/admin/books/${id}/rights`, { rightsStatus: 'VERIFIED', rightsNote: 'contrat 2026', territories: ['bj', 'ci'] });
    expect((await post(`/admin/books/${id}/publish`, {})).statusCode).toBe(409);

    // Ajout du fichier de diffusion → publication possible
    await h.db.audioAsset.create({ data: { bookId: id, kind: 'STREAM', auraObjectId: 'o', sha256: 'e'.repeat(64), sizeBytes: 10n, durationSec: 100, mimeType: 'audio/mp4' } });
    await h.db.book.update({ where: { id }, data: { durationSec: 100 } });
    expect((await post(`/admin/books/${id}/publish`, {})).statusCode).toBe(200);
    expect(await h.db.book.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'PUBLISHED', territories: ['BJ', 'CI'] });
    expect((await h.app.inject({ method: 'GET', url: `/catalog/books/${slug}` })).statusCode).toBe(200);

    // Retirer les droits dépublie immédiatement
    const r = await put(`/admin/books/${id}/rights`, { rightsStatus: 'UNVERIFIED', territories: [] });
    expect(r.json()).toMatchObject({ unpublished: true });
    expect((await h.app.inject({ method: 'GET', url: `/catalog/books/${slug}` })).statusCode).toBe(404);
  });

  it('modification, résumés, catégories', async () => {
    const b = await seedPublishedBook(h, { slug: 'a-modifier', title: 'À modifier' });
    expect((await h.app.inject({ method: 'PATCH', url: `/admin/books/${b.id}`, headers: h.auth(admin.token), payload: { title: 'Modifié', isPriority: true } })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: `/admin/books/${b.id}`, headers: h.auth(admin.token) })).json()).toMatchObject({ title: 'Modifié', isPriority: true });
    expect((await put(`/admin/books/${b.id}/essentials`, { understandMd: 'U', applyMd: 'A', published: true })).statusCode).toBe(200);
    expect((await put('/admin/categories', { slug: 'nouveaute', name: 'Nouveauté', position: 99 })).statusCode).toBe(200);
    expect((await post('/admin/books', { title: 'X', authorName: 'Y', categorySlug: 'inexistante' })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: '/admin/books?status=PUBLISHED&q=modifi', headers: h.auth(admin.token) })).json()).toMatchObject({ total: 1 });
  });
});

describe('imports', () => {
  it('chemins sûrs', () => {
    for (const ok of ['livre.mp3', 'a/b/c.m4a', 'dossier avec espaces/x.wav']) expect(isSafeRelativePath(ok)).toBe(true);
    for (const bad of ['/etc/passwd', '../secret', 'a/../../b', 'a\\b', 'C:\\x', 'x\0y', '..']) expect(isSafeRelativePath(bad)).toBe(false);
  });

  it('crée un import et le met en file ; refuse la traversée de répertoire', async () => {
    const before = h.enqueued.length;
    const ok = await post('/admin/imports', { sourceType: 'LOCAL_PATH', sourceRef: 'lot1/livre.mp3', title: 'Livre', authorName: 'Auteur' });
    expect(ok.statusCode).toBe(201);
    expect(h.enqueued.length).toBe(before + 1);
    expect((await post('/admin/imports', { sourceType: 'LOCAL_PATH', sourceRef: '../../etc/passwd' })).statusCode).toBe(400);
    expect((await post('/admin/imports', { sourceType: 'LOCAL_PATH', sourceRef: '/etc/passwd' })).statusCode).toBe(400);
    expect((await post('/admin/imports', { sourceType: 'AURA_OBJECT', sourceRef: 'pas-un-uuid' })).statusCode).toBe(400);
    expect(h.enqueued.length).toBe(before + 1);
  });

  it('un lot est accepté en entier ou refusé en entier', async () => {
    const countBefore = await h.db.importJob.count();
    const bad = await post('/admin/imports/batch', { items: [{ sourceType: 'LOCAL_PATH', sourceRef: 'ok.mp3' }, { sourceType: 'LOCAL_PATH', sourceRef: '../mauvais.mp3' }] });
    expect(bad.statusCode).toBe(400);
    expect(await h.db.importJob.count()).toBe(countBefore);
    const good = await post('/admin/imports/batch', { items: [{ sourceType: 'LOCAL_PATH', sourceRef: 'a.mp3' }, { sourceType: 'LOCAL_PATH', sourceRef: 'b.mp3' }] });
    expect(good.statusCode).toBe(201);
    expect(await h.db.importJob.count()).toBe(countBefore + 2);
  });

  it('relance seulement un import en échec', async () => {
    const job = await h.db.importJob.create({ data: { sourceType: 'LOCAL_PATH', sourceRef: 'x.mp3', status: 'FAILED', stage: 'NORMALIZE', error: 'boom' } });
    const queued = await h.db.importJob.create({ data: { sourceType: 'LOCAL_PATH', sourceRef: 'y.mp3' } });
    expect((await post(`/admin/imports/${queued.id}/retry`, {})).statusCode).toBe(409);
    expect((await post(`/admin/imports/${job.id}/retry`, {})).statusCode).toBe(200);
    expect(await h.db.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'QUEUED', error: null });
    expect(h.enqueued).toContain(job.id);
  });
});

describe('utilisateurs et statistiques', () => {
  it('octroi manuel d’un abonnement puis statistiques', async () => {
    const target = await h.login('92000010');
    const g = await post(`/admin/users/${target.userId}/grant`, { plan: 'ANNUAL', reason: 'partenariat média' });
    expect(g.statusCode).toBe(201);
    const me = (await h.app.inject({ method: 'GET', url: '/me', headers: h.auth(target.token) })).json() as { subscriptionEndsAt: string | null };
    expect(me.subscriptionEndsAt).not.toBeNull();

    const list = (await h.app.inject({ method: 'GET', url: '/admin/users?q=9200001', headers: h.auth(admin.token) })).json() as { items: { phone: string }[] };
    expect(list.items.some((u) => u.phone.endsWith('92000010'))).toBe(true);

    // une écoute et un paiement pour alimenter les stats
    const b = await seedPublishedBook(h, { slug: 'stat-book', title: 'Livre stat' });
    await h.app.inject({ method: 'PUT', url: `/library/progress/${b.id}`, headers: h.auth(target.token), payload: { positionSec: 10, listenedSec: 1800 } });
    await h.db.payment.create({ data: { userId: target.userId, plan: 'ANNUAL', amountXof: 25000, provider: 'MANUAL', status: 'PAID', paidAt: new Date() } });
    const stats = (await h.app.inject({ method: 'GET', url: '/admin/stats', headers: h.auth(admin.token) })).json() as {
      activeSubscribers: number; revenueXofLast30Days: number; listenedHoursLast30Days: number; topBooks: { title: string }[];
    };
    expect(stats.activeSubscribers).toBeGreaterThanOrEqual(1);
    expect(stats.revenueXofLast30Days).toBe(25000);
    expect(stats.listenedHoursLast30Days).toBe(0.5);
    expect(stats.topBooks[0]?.title).toBe('Livre stat');
  });

  it('octroi à un utilisateur inconnu → 404 ; motif trop court → 400', async () => {
    expect((await post('/admin/users/00000000-0000-0000-0000-000000000000/grant', { plan: 'ANNUAL', reason: 'test ok' })).statusCode).toBe(404);
    expect((await post(`/admin/users/${user.userId}/grant`, { plan: 'ANNUAL', reason: 'a' })).statusCode).toBe(400);
  });
});
