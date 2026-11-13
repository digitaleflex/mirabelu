import type { FastifyPluginAsync } from 'fastify';
import { bookmarkBody, progressBody, pageQuery } from '@mirabelu/contracts';
import { authOf, parse, type Ctx } from '../context.js';
import { notFound } from '../errors.js';
import { publicBookWhere } from '../access.js';
import { bookInclude, toBookSummary } from '../mappers.js';

export const libraryRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db } = ctx;
  app.addHook('preHandler', ctx.requireAuth);

  async function assertBook(bookId: string): Promise<void> {
    const b = await db.book.findFirst({ where: { id: bookId, ...publicBookWhere }, select: { id: true } });
    if (!b) throw notFound('Livre introuvable');
  }

  // --- Favoris ---------------------------------------------------------------
  app.get('/library/favorites', async (req) => {
    const rows = await db.favorite.findMany({
      where: { userId: authOf(req).userId, book: publicBookWhere },
      include: { book: { include: bookInclude } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => toBookSummary(r.book));
  });

  app.put<{ Params: { bookId: string } }>('/library/favorites/:bookId', async (req) => {
    await assertBook(req.params.bookId);
    const userId = authOf(req).userId;
    await db.favorite.upsert({
      where: { userId_bookId: { userId, bookId: req.params.bookId } },
      create: { userId, bookId: req.params.bookId },
      update: {},
    });
    return { isFavorite: true };
  });

  app.delete<{ Params: { bookId: string } }>('/library/favorites/:bookId', async (req) => {
    await db.favorite.deleteMany({ where: { userId: authOf(req).userId, bookId: req.params.bookId } });
    return { isFavorite: false };
  });

  // --- Progression et historique --------------------------------------------
  app.put<{ Params: { bookId: string } }>('/library/progress/:bookId', async (req) => {
    const body = parse(progressBody, req.body);
    await assertBook(req.params.bookId);
    const userId = authOf(req).userId;
    const bookId = req.params.bookId;
    await db.progress.upsert({
      where: { userId_bookId: { userId, bookId } },
      create: { userId, bookId, positionSec: body.positionSec, completed: body.completed ?? false },
      update: { positionSec: body.positionSec, ...(body.completed !== undefined ? { completed: body.completed } : {}) },
    });
    if (body.listenedSec && body.listenedSec > 0) {
      // Valeur déclarée par le client : on borne le total par 24 h glissantes à 24 h d'écoute par utilisateur,
      // pour que des statistiques (et d'éventuels calculs de droits) ne soient pas gonflées à volonté.
      const since = new Date(ctx.clock().getTime() - 86_400_000);
      const used = await db.listenEvent.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { seconds: true } });
      const credited = Math.min(body.listenedSec, Math.max(0, 86_400 - (used._sum.seconds ?? 0)));
      if (credited > 0) await db.listenEvent.create({ data: { userId, bookId, seconds: credited } });
    }
    return { ok: true };
  });

  app.get('/library/history', async (req) => {
    const q = parse(pageQuery, req.query);
    const where = { userId: authOf(req).userId, book: publicBookWhere };
    const [total, rows] = await Promise.all([
      db.progress.count({ where }),
      db.progress.findMany({
        where,
        include: { book: { include: bookInclude } },
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => ({
        book: toBookSummary(r.book),
        positionSec: r.positionSec,
        completed: r.completed,
        updatedAt: r.updatedAt.toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  });

  // --- Marque-pages ---------------------------------------------------------
  app.get<{ Params: { bookId: string } }>('/library/bookmarks/:bookId', async (req) => {
    const rows = await db.bookmark.findMany({
      where: { userId: authOf(req).userId, bookId: req.params.bookId },
      orderBy: { positionSec: 'asc' },
    });
    return rows.map((b) => ({ id: b.id, bookId: b.bookId, positionSec: b.positionSec, note: b.note, createdAt: b.createdAt.toISOString() }));
  });

  app.post<{ Params: { bookId: string } }>('/library/bookmarks/:bookId', async (req, reply) => {
    const body = parse(bookmarkBody, req.body);
    await assertBook(req.params.bookId);
    const count = await db.bookmark.count({ where: { userId: authOf(req).userId, bookId: req.params.bookId } });
    if (count >= 200) {
      return reply.status(409).send({ error: { code: 'LIMIT_REACHED', message: 'Limite de 200 marque-pages atteinte pour ce livre.' } });
    }
    const b = await db.bookmark.create({
      data: { userId: authOf(req).userId, bookId: req.params.bookId, positionSec: body.positionSec, note: body.note ?? null },
    });
    return reply.status(201).send({ id: b.id, bookId: b.bookId, positionSec: b.positionSec, note: b.note, createdAt: b.createdAt.toISOString() });
  });

  app.delete<{ Params: { id: string } }>('/library/bookmarks/item/:id', async (req) => {
    await db.bookmark.deleteMany({ where: { id: req.params.id, userId: authOf(req).userId } });
    return { ok: true };
  });
};
