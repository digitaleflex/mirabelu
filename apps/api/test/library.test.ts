import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, seedPublishedBook, type Harness } from './helpers.js';

let h: Harness;
let bookId: string;
beforeAll(async () => {
  h = await createHarness();
  bookId = (await seedPublishedBook(h)).id;
});
afterAll(async () => { await h.close(); });

describe('bibliothèque', () => {
  it('favoris : ajout idempotent, liste, retrait', async () => {
    const s = await h.login('96000001');
    for (let i = 0; i < 2; i++) {
      expect((await h.app.inject({ method: 'PUT', url: `/library/favorites/${bookId}`, headers: h.auth(s.token) })).statusCode).toBe(200);
    }
    const list = (await h.app.inject({ method: 'GET', url: '/library/favorites', headers: h.auth(s.token) })).json() as unknown[];
    expect(list).toHaveLength(1);
    const detail = (await h.app.inject({ method: 'GET', url: '/catalog/books/atomic-habits', headers: h.auth(s.token) })).json() as { isFavorite: boolean };
    expect(detail.isFavorite).toBe(true);
    await h.app.inject({ method: 'DELETE', url: `/library/favorites/${bookId}`, headers: h.auth(s.token) });
    expect(((await h.app.inject({ method: 'GET', url: '/library/favorites', headers: h.auth(s.token) })).json() as unknown[])).toHaveLength(0);
  });

  it('progression, historique et statistiques d’écoute', async () => {
    const s = await h.login('96000002');
    await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(s.token), payload: { positionSec: 100, listenedSec: 30 } });
    await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(s.token), payload: { positionSec: 3500, completed: true, listenedSec: 45 } });
    const hist = (await h.app.inject({ method: 'GET', url: '/library/history', headers: h.auth(s.token) })).json() as { items: { positionSec: number; completed: boolean }[] };
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0]).toMatchObject({ positionSec: 3500, completed: true });
    expect(await h.db.listenEvent.aggregate({ where: { userId: s.userId }, _sum: { seconds: true } })).toMatchObject({ _sum: { seconds: 75 } });
  });

  it('refuse les valeurs de progression aberrantes', async () => {
    const s = await h.login('96000003');
    const r = await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(s.token), payload: { positionSec: -5 } });
    expect(r.statusCode).toBe(400);
    const big = await h.app.inject({ method: 'PUT', url: `/library/progress/${bookId}`, headers: h.auth(s.token), payload: { positionSec: 10, listenedSec: 999999 } });
    expect(big.statusCode).toBe(400);
  });

  it('marque-pages : création, liste triée, suppression, isolation entre utilisateurs', async () => {
    const a = await h.login('96000004');
    const b = await h.login('96000005');
    await h.app.inject({ method: 'POST', url: `/library/bookmarks/${bookId}`, headers: h.auth(a.token), payload: { positionSec: 900, note: 'à relire' } });
    const created = await h.app.inject({ method: 'POST', url: `/library/bookmarks/${bookId}`, headers: h.auth(a.token), payload: { positionSec: 60 } });
    expect(created.statusCode).toBe(201);
    const list = (await h.app.inject({ method: 'GET', url: `/library/bookmarks/${bookId}`, headers: h.auth(a.token) })).json() as { id: string; positionSec: number }[];
    expect(list.map((x) => x.positionSec)).toEqual([60, 900]);

    // b ne peut ni voir ni supprimer les marque-pages de a
    expect(((await h.app.inject({ method: 'GET', url: `/library/bookmarks/${bookId}`, headers: h.auth(b.token) })).json() as unknown[])).toHaveLength(0);
    await h.app.inject({ method: 'DELETE', url: `/library/bookmarks/item/${list[0]?.id}`, headers: h.auth(b.token) });
    expect(await h.db.bookmark.count({ where: { userId: a.userId } })).toBe(2);

    await h.app.inject({ method: 'DELETE', url: `/library/bookmarks/item/${list[0]?.id}`, headers: h.auth(a.token) });
    expect(await h.db.bookmark.count({ where: { userId: a.userId } })).toBe(1);
  });

  it('exige l’authentification', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/library/favorites' })).statusCode).toBe(401);
  });
});
