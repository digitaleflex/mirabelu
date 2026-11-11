import type { FastifyPluginAsync } from 'fastify';
import { authOf, type Ctx } from '../context.js';
import { forbidden, notFound } from '../errors.js';
import { canListen, publicBookWhere } from '../access.js';
import { countryOfPhone } from '../phone.js';
import { PlaybackUrlCache } from '../playback-cache.js';

export const playbackRoutes = (ctx: Ctx): FastifyPluginAsync => async (app) => {
  const { db, storage, env, clock } = ctx;
  const cache = new PlaybackUrlCache(env.PLAYBACK_URL_CACHE_SECONDS * 1000);

  /**
   * Émet (ou renouvelle) l'URL de lecture d'un livre. Le lecteur appelle cette route au chargement,
   * puis ~1 minute avant expiration, et sur toute erreur 403/410 du média.
   */
  app.post<{ Params: { bookId: string } }>('/playback/:bookId/url', { preHandler: ctx.requireAuth }, async (req) => {
    const { userId, role } = authOf(req);
    const now = clock();
    if (!(await canListen(db, userId, role, now))) throw forbidden('Abonnement requis', 'SUBSCRIPTION_REQUIRED');

    const book = await db.book.findFirst({
      where: { id: req.params.bookId, ...publicBookWhere },
      include: { assets: { where: { kind: 'STREAM' } } },
    });
    const asset = book?.assets[0];
    if (!book || !asset) throw notFound('Livre indisponible');

    if (book.territories.length > 0 && role !== 'ADMIN') {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
      const country = countryOfPhone(user.phone);
      if (!country || !book.territories.includes(country)) {
        throw forbidden('Ce livre n’est pas disponible dans votre pays', 'TERRITORY_RESTRICTED');
      }
    }

    const signed = await cache.get(`${userId}:${book.id}`, now.getTime(), () => storage.previewUrl(asset.auraObjectId));
    const progress = await db.progress.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } });

    return {
      url: signed.url,
      expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
      contentType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      durationSec: asset.durationSec,
      resumeAtSec: progress && !progress.completed ? progress.positionSec : 0,
    };
  });
};
