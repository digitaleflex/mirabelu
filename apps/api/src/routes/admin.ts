import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  adminBookBody, adminBookPatch, adminCategoryBody, essentialsBody, grantSubscriptionBody, importBatchBody,
  importCreateBody, pageQuery, rightsBody, type ImportDto, type StatsDto,
} from '@mirabelu/contracts';
import { grantSubscription } from '@mirabelu/billing';
import { authOf, parse, type Ctx } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { bookInclude, slugify, toBookSummary } from '../mappers.js';

const DAY = 86_400_000;

/**
 * Un chemin d'import est relatif à IMPORT_DIR : pas d'absolu, pas de « .. », pas d'octet nul.
 * Le worker applique une seconde défense (résolution réelle + confinement dans IMPORT_DIR).
 */
export function isSafeRelativePath(p: string): boolean {
  if (p.includes('\0') || p.includes('\\')) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..');
}

const AURA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, queue, clock } = ctx;
  app.addHook('preHandler', ctx.requireAdmin);

  const toImportDto = (j: {
    id: string; status: ImportDto['status']; stage: string; sourceType: 'LOCAL_PATH' | 'AURA_OBJECT'; sourceRef: string;
    bookId: string | null; title: string | null; error: string | null; attempts: number; createdAt: Date; finishedAt: Date | null;
  }): ImportDto => ({
    id: j.id, status: j.status, stage: j.stage, sourceType: j.sourceType, sourceRef: j.sourceRef, bookId: j.bookId,
    title: j.title, error: j.error, attempts: j.attempts, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null,
  });

  async function uniqueBookSlug(base: string): Promise<string> {
    let candidate = base;
    for (let i = 2; await db.book.findUnique({ where: { slug: candidate }, select: { id: true } }); i++) {
      candidate = `${base}-${i}`;
    }
    return candidate;
  }

  async function upsertAuthor(name: string) {
    const slug = slugify(name);
    return db.author.upsert({ where: { slug }, create: { name, slug }, update: {} });
  }

  // --- Livres -------------------------------------------------------------------
  const adminBookQuery = pageQuery.extend({
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'UNPUBLISHED']).optional(),
  });

  app.get('/admin/books', async (req) => {
    const q = parse(adminBookQuery, req.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' as const } }, { author: { name: { contains: q.q, mode: 'insensitive' as const } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db.book.count({ where }),
      db.book.findMany({ where, include: bookInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map((b) => ({ ...toBookSummary(b), status: b.status, rightsStatus: b.rightsStatus, isPriority: b.isPriority })),
      page: q.page, pageSize: q.pageSize, total,
    };
  });

  app.get<{ Params: { id: string } }>('/admin/books/:id', async (req) => {
    const b = await db.book.findUnique({
      where: { id: req.params.id },
      include: { ...bookInclude, chapters: { orderBy: { position: 'asc' } }, assets: true, essentials: true },
    });
    if (!b) throw notFound('Livre introuvable');
    return {
      ...toBookSummary(b),
      description: b.description, status: b.status, rightsStatus: b.rightsStatus, rightsNote: b.rightsNote,
      territories: b.territories, isPriority: b.isPriority, publishedAt: b.publishedAt?.toISOString() ?? null,
      chapters: b.chapters.map((c) => ({ position: c.position, title: c.title, startSec: c.startSec, endSec: c.endSec })),
      assets: b.assets.map((a) => ({ kind: a.kind, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), durationSec: a.durationSec, mimeType: a.mimeType, bitrateKbps: a.bitrateKbps })),
      essentials: b.essentials ? { understandMd: b.essentials.understandMd, applyMd: b.essentials.applyMd, published: b.essentials.published } : null,
    };
  });

  app.post('/admin/books', async (req, reply) => {
    const body = parse(adminBookBody, req.body);
    const category = await db.category.findUnique({ where: { slug: body.categorySlug } });
    if (!category) throw badRequest('Catégorie inconnue', 'UNKNOWN_CATEGORY');
    const author = await upsertAuthor(body.authorName);
    if (body.slug && (await db.book.findUnique({ where: { slug: body.slug } }))) throw conflict('Ce slug est déjà utilisé', 'SLUG_TAKEN');
    const slug = body.slug ?? (await uniqueBookSlug(slugify(body.title)));
    const book = await db.book.create({
      data: {
        slug, title: body.title, authorId: author.id, categoryId: category.id, description: body.description, language: body.language,
        coverUrl: body.coverUrl ?? null, isPriority: body.isPriority,
      },
    });
    return reply.status(201).send({ id: book.id, slug: book.slug });
  });

  app.patch<{ Params: { id: string } }>('/admin/books/:id', async (req) => {
    const body = parse(adminBookPatch, req.body);
    const existing = await db.book.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Livre introuvable');
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.language !== undefined) data.language = body.language;
    if (body.coverUrl !== undefined) data.coverUrl = body.coverUrl;
    if (body.isPriority !== undefined) data.isPriority = body.isPriority;
    if (body.slug !== undefined && body.slug !== existing.slug) {
      if (await db.book.findUnique({ where: { slug: body.slug } })) throw conflict('Ce slug est déjà utilisé', 'SLUG_TAKEN');
      data.slug = body.slug;
    }
    if (body.authorName !== undefined) data.authorId = (await upsertAuthor(body.authorName)).id;
    if (body.categorySlug !== undefined) {
      const c = await db.category.findUnique({ where: { slug: body.categorySlug } });
      if (!c) throw badRequest('Catégorie inconnue', 'UNKNOWN_CATEGORY');
      data.categoryId = c.id;
    }
    await db.book.update({ where: { id: existing.id }, data });
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/admin/books/:id/rights', async (req) => {
    const body = parse(rightsBody, req.body);
    const book = await db.book.findUnique({ where: { id: req.params.id } });
    if (!book) throw notFound('Livre introuvable');
    // Retirer la vérification des droits d'un livre publié le dépublie : jamais de diffusion sans droits.
    const unpublish = body.rightsStatus === 'UNVERIFIED' && book.status === 'PUBLISHED';
    await db.book.update({
      where: { id: book.id },
      data: {
        rightsStatus: body.rightsStatus, rightsNote: body.rightsNote ?? null, territories: body.territories.map((t) => t.toUpperCase()),
        ...(unpublish ? { status: 'UNPUBLISHED' as const } : {}),
      },
    });
    return { ok: true, unpublished: unpublish };
  });

  app.put<{ Params: { id: string } }>('/admin/books/:id/essentials', async (req) => {
    const body = parse(essentialsBody, req.body);
    if (!(await db.book.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('Livre introuvable');
    await db.bookEssentials.upsert({ where: { bookId: req.params.id }, create: { bookId: req.params.id, ...body }, update: body });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/books/:id/publish', async (req) => {
    const book = await db.book.findUnique({ where: { id: req.params.id }, include: { assets: { where: { kind: 'STREAM' } } } });
    if (!book) throw notFound('Livre introuvable');
    const problems: string[] = [];
    if (book.rightsStatus !== 'VERIFIED') problems.push('droits non vérifiés');
    if (book.assets.length === 0) problems.push('aucun fichier audio de diffusion');
    if (book.durationSec <= 0) problems.push('durée inconnue');
    if (problems.length > 0) throw conflict(`Publication impossible : ${problems.join(', ')}`, 'NOT_PUBLISHABLE');
    await db.book.update({ where: { id: book.id }, data: { status: 'PUBLISHED', publishedAt: book.publishedAt ?? clock() } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/books/:id/unpublish', async (req) => {
    const r = await db.book.updateMany({ where: { id: req.params.id, status: 'PUBLISHED' }, data: { status: 'UNPUBLISHED' } });
    if (r.count === 0) throw notFound('Livre publié introuvable');
    return { ok: true };
  });

  // --- Catégories -----------------------------------------------------------------
  app.get('/admin/categories', async () => {
    const rows = await db.category.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { books: true } } } });
    return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, position: c.position, bookCount: c._count.books }));
  });

  app.put('/admin/categories', async (req) => {
    const body = parse(adminCategoryBody, req.body);
    const c = await db.category.upsert({ where: { slug: body.slug }, create: body, update: { name: body.name, position: body.position } });
    return { id: c.id };
  });

  // --- Imports ----------------------------------------------------------------------
  async function createImport(input: z.infer<typeof importCreateBody>, adminId: string) {
    if (input.sourceType === 'LOCAL_PATH' && !isSafeRelativePath(input.sourceRef)) {
      throw badRequest('Chemin d’import invalide (relatif à IMPORT_DIR, sans « .. »)', 'INVALID_PATH');
    }
    if (input.sourceType === 'AURA_OBJECT' && !AURA_ID.test(input.sourceRef)) {
      throw badRequest('Identifiant d’objet AURA invalide', 'INVALID_OBJECT_ID');
    }
    if (input.bookId && !(await db.book.findUnique({ where: { id: input.bookId }, select: { id: true } }))) throw notFound('Livre introuvable');
    if (input.categorySlug && !(await db.category.findUnique({ where: { slug: input.categorySlug }, select: { id: true } }))) {
      throw badRequest('Catégorie inconnue', 'UNKNOWN_CATEGORY');
    }
    const job = await db.importJob.create({
      data: {
        sourceType: input.sourceType, sourceRef: input.sourceRef, title: input.title ?? null, authorName: input.authorName ?? null,
        categorySlug: input.categorySlug ?? null, bookId: input.bookId ?? null, createdById: adminId,
      },
    });
    await queue.enqueueImport({ importJobId: job.id });
    return job;
  }

  app.post('/admin/imports', async (req, reply) => {
    const job = await createImport(parse(importCreateBody, req.body), authOf(req).userId);
    return reply.status(201).send(toImportDto(job));
  });

  app.post('/admin/imports/batch', async (req, reply) => {
    const body = parse(importBatchBody, req.body);
    // Validation complète avant toute création : un lot est accepté en entier ou refusé.
    for (const item of body.items) {
      if (item.sourceType === 'LOCAL_PATH' && !isSafeRelativePath(item.sourceRef)) throw badRequest(`Chemin invalide : ${item.sourceRef}`, 'INVALID_PATH');
      if (item.sourceType === 'AURA_OBJECT' && !AURA_ID.test(item.sourceRef)) throw badRequest(`Identifiant AURA invalide : ${item.sourceRef}`, 'INVALID_OBJECT_ID');
    }
    const jobs = [];
    for (const item of body.items) jobs.push(await createImport(item, authOf(req).userId));
    return reply.status(201).send({ items: jobs.map(toImportDto) });
  });

  app.get('/admin/imports', async (req) => {
    const q = parse(pageQuery.extend({ status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']).optional() }), req.query);
    const where = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      db.importJob.count({ where }),
      db.importJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map(toImportDto), page: q.page, pageSize: q.pageSize, total };
  });

  app.post<{ Params: { id: string } }>('/admin/imports/:id/retry', async (req) => {
    const r = await db.importJob.updateMany({
      where: { id: req.params.id, status: 'FAILED' },
      data: { status: 'QUEUED', stage: 'QUEUED', error: null, finishedAt: null, attempts: 0 },
    });
    if (r.count === 0) throw conflict('Seul un import en échec peut être relancé', 'NOT_RETRYABLE');
    await queue.enqueueImport({ importJobId: req.params.id });
    return { ok: true };
  });

  // --- Utilisateurs et abonnements ----------------------------------------------------
  app.get('/admin/users', async (req) => {
    const q = parse(pageQuery.extend({ q: z.string().trim().min(1).max(30).optional() }), req.query);
    const where = q.q ? { phone: { contains: q.q.replace(/\s+/g, '') } } : {};
    const now = clock();
    const [total, rows] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { subscriptions: { where: { status: 'ACTIVE', endsAt: { gt: now } }, orderBy: { endsAt: 'desc' }, take: 1 } },
      }),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id, phone: u.phone, name: u.name, role: u.role, createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null, subscriptionEndsAt: u.subscriptions[0]?.endsAt.toISOString() ?? null,
      })),
      page: q.page, pageSize: q.pageSize, total,
    };
  });

  app.post<{ Params: { id: string } }>('/admin/users/:id/grant', async (req, reply) => {
    const body = parse(grantSubscriptionBody, req.body);
    if (!(await db.user.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('Utilisateur introuvable');
    const sub = await grantSubscription(db, { userId: req.params.id, plan: body.plan, note: `Octroi manuel par ${authOf(req).userId} : ${body.reason}` }, clock());
    return reply.status(201).send({ id: sub.id, endsAt: sub.endsAt.toISOString() });
  });

  // --- Statistiques -----------------------------------------------------------------------
  app.get('/admin/stats', async (): Promise<StatsDto> => {
    const now = clock();
    const since = new Date(now.getTime() - 30 * DAY);
    const [activeSubscribers, revenue, newSubs, listened, publishedBooks, top] = await Promise.all([
      db.subscription.findMany({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }, distinct: ['userId'], select: { userId: true } }),
      db.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { amountXof: true } }),
      db.subscription.findMany({ where: { createdAt: { gte: since } }, distinct: ['userId'], select: { userId: true } }),
      db.listenEvent.aggregate({ where: { createdAt: { gte: since } }, _sum: { seconds: true } }),
      db.book.count({ where: { status: 'PUBLISHED' } }),
      db.listenEvent.groupBy({ by: ['bookId'], where: { createdAt: { gte: since } }, _sum: { seconds: true }, orderBy: { _sum: { seconds: 'desc' } }, take: 5 }),
    ]);
    const titles = await db.book.findMany({ where: { id: { in: top.map((t) => t.bookId) } }, select: { id: true, title: true } });
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    return {
      activeSubscribers: activeSubscribers.length,
      revenueXofLast30Days: revenue._sum.amountXof ?? 0,
      newSubscribersLast30Days: newSubs.length,
      listenedHoursLast30Days: Math.round(((listened._sum.seconds ?? 0) / 3600) * 10) / 10,
      publishedBooks,
      topBooks: top.map((t) => ({ bookId: t.bookId, title: titleOf.get(t.bookId) ?? '—', listenedHours: Math.round(((t._sum.seconds ?? 0) / 3600) * 10) / 10 })),
    };
  });
};
