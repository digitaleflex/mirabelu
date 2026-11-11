'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { Loading } from './states';

/** Réserve un contenu aux personnes connectées. */
export function RequireLogin({ children, next }: { children: ReactNode; next: string }) {
  const { user, ready } = useSession();
  if (!ready) return <div className="page"><Loading /></div>;
  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <h1>Connectez-vous</h1>
          <p className="muted">Entrez votre numéro de téléphone pour retrouver votre bibliothèque.</p>
          <Link className="btn primary" href={`/connexion?next=${encodeURIComponent(next)}`}>Se connecter</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return <div className="page"><Loading /></div>;
  if (!user) {
    return (
      <div className="page"><div className="empty"><h1>Connexion requise</h1>
        <Link className="btn primary" href="/connexion?next=/admin">Se connecter</Link></div></div>
    );
  }
  if (user.role !== 'ADMIN') {
    return <div className="page"><div className="notice error" role="alert">Cet espace est réservé aux administrateurs.</div></div>;
  }
  return <>{children}</>;
}
