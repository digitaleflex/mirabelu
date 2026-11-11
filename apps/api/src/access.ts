import type { Db } from '@mirabelu/database';
import { activeSubscription } from '@mirabelu/billing';

/** Vrai si l'utilisateur peut écouter : abonnement en cours ou administrateur. */
export async function canListen(db: Db, userId: string, role: 'SUBSCRIBER' | 'ADMIN', now: Date): Promise<boolean> {
  if (role === 'ADMIN') return true;
  return (await activeSubscription(db, userId, now)) !== null;
}

/** Un livre n'est visible/écoutable que publié ET droits vérifiés. */
export const publicBookWhere = { status: 'PUBLISHED', rightsStatus: 'VERIFIED' } as const;
