import type { ApiEnv } from '@mirabelu/config';
import type { Db } from '@mirabelu/database';

/**
 * Aligne les rôles sur ADMIN_PHONES au démarrage : ADMIN_PHONES est la seule source des administrateurs.
 * Un numéro retiré de la liste est rétrogradé et ses sessions sont révoquées.
 * Retourne le nombre de comptes rétrogradés.
 */
export async function syncAdmins(db: Db, env: Pick<ApiEnv, 'ADMIN_PHONES'>, now: Date = new Date()): Promise<number> {
  const stale = await db.user.findMany({
    where: { role: 'ADMIN', phone: { notIn: env.ADMIN_PHONES } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const ids = stale.map((u) => u.id);
  await db.$transaction([
    db.user.updateMany({ where: { id: { in: ids } }, data: { role: 'SUBSCRIBER' } }),
    db.refreshToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  return ids.length;
}
