import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { catalogQuery, type BookDetailDto } from '@mirabelu/contracts';
import { authOf, parse, type Ctx } from '../context.js';
import { forbidden, notFound } from '../errors.js';
import { canListen, publicBookWhere } from '../access.js';
import { bookInclude, toBookSummary } from '../mappers.js';

export const catalogRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, clock } = ctx;

  /** Authentification facultative : le catalogue est public, l'état personnel dépend de la session. */
  async function optionalAuth(req: FastifyRequest): Promise<void> {
    if (!req.headers.authorization) return;
    await ctx.requireAuth(req, undefined as never);
  }

  app.get('/catalog/categories', async () => {
    const cats = await db.category.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      where: { books: { some: publicBookWhere } },
    });
    return cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
  });

  app.get('/catalog/books', async (req) => {
    const q = parse(catalogQuery, req.query);
    const where = {
      ...publicBookWhere,
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' as const } },
              { author: { name: { contains: q.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.book.count({ where }),
      db.book.findMany({
        where,
        include: bookInclude,
        orderBy: [{ isPriority: 'desc' }, { publishedAt: 'desc' }, { title: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map(toBookSummary), page: q.page, pageSize: q.pageSize, total };
  });

  /** Page d'accueil : nouveautés et sélection mise en avant. */
  app.get('/catalog/home', async () => {
    const [featured, latest] = await Promise.all([
      db.book.findMany({ where: { ...publicBookWhere, isPriority: true }, include: bookInclude, orderBy: { publishedAt: 'desc' }, take: 12 }),
      db.book.findMany({ where: publicBookWhere, include: bookInclude, orderBy: { publishedAt: 'desc' }, take: 12 }),
    ]);
    return { featured: featured.map(toBookSummary), latest: latest.map(toBookSummary) };
  });

  app.get<{ Params: { slug: string } }>('/catalog/books/:slug', { preHandler: optionalAuth }, async (req): Promise<BookDetailDto> => {
    const book = await db.book.findFirst({
      where: { slug: req.params.slug, ...publicBookWhere },
      include: { ...bookInclude, chapters: { orderBy: { position: 'asc' } } },
    });
    if (!book) throw notFound('Livre introuvable');

    let isFavorite = false;
    let progressSec = 0;
    let listen = false;
    if (req.auth) {
      const { userId, role } = req.auth;
      const [fav, prog, ok] = await Promise.all([
        db.favorite.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } }),
        db.progress.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } }),
        canListen(db, userId, role, clock()),
      ]);
      isFavorite = fav !== null;
      progressSec = prog?.positionSec ?? 0;
      listen = ok;
    }
    return {
      ...toBookSummary(book),
      description: book.description,
      chapters: book.chapters.map((c) => ({ position: c.position, title: c.title, startSec: c.startSec, endSec: c.endSec })),
      isFavorite,
      progressSec,
      canListen: listen,
    };
  });

  /** « Comprendre » et « Appliquer » : réservé aux abonnés. */
  app.get<{ Params: { slug: string } }>('/catalog/books/:slug/essentials', { preHandler: ctx.requireAuth }, async (req) => {
    const { userId, role } = authOf(req);
    if (!(await canListen(db, userId, role, clock()))) throw forbidden('Abonnement requis', 'SUBSCRIPTION_REQUIRED');
    const book = await db.book.findFirst({
      where: { slug: req.params.slug, ...publicBookWhere },
      include: { essentials: true },
    });
    if (!book?.essentials?.published) throw notFound('Aucun résumé disponible pour ce livre');
    return { understandMd: book.essentials.understandMd, applyMd: book.essentials.applyMd };
  });

};
