'use client';

import Link from 'next/link';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows, BookTiles } from '@/components/book-list';
import { Cover } from '@/components/cover';
import { EmptyState, Skeleton, SkeletonText } from '@/components/ui';
import { ErrorBox } from '@/components/states';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Home { featured: BookSummaryDto[]; latest: BookSummaryDto[] }
interface History { items: { book: BookSummaryDto; positionSec: number; completed: boolean }[] }

export default function HomePage() {
  const { user, isSubscriber } = useSession();
  const home = useApi<Home>('/catalog/home');
  const hist = useApi<History>(user ? '/library/history?pageSize=3' : null);

  const resume = hist.data?.items.filter((i) => !i.completed && i.positionSec > 0) ?? [];
  const hero = home.data?.featured?.[0];

  return (
    <div className="page">
      {/* Hero */}
      <section className="hero-cover" style={{ display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center' }}>
        {home.loading && <Skeleton style={{ width: 'min(70vw, 280px)', aspectRatio: '1', borderRadius: 16 }} />}
        {hero && (
          <div className="glow">
            <Cover title={hero.title} url={hero.coverUrl} />
          </div>
        )}
        <div className="stack" style={{ justifyItems: 'center' }}>
          <h1 className="display ripen" style={{ fontSize: 'clamp(1.8rem, 7vw, 2.6rem)' }}>
            Écoutez le livre.<br />Gardez l’essentiel.
          </h1>
          <p className="lead">Des livres complets à écouter partout, et pour chacun, ce qu’il faut comprendre et appliquer dès demain.</p>
          {!isSubscriber && (
            <div className="cluster" style={{ marginTop: 8, justifyContent: 'center' }}>
              <Link className="btn primary" href="/abonnement">Voir les formules</Link>
              {!user && <Link className="btn" href="/connexion">Se connecter</Link>}
            </div>
          )}
          {hero && isSubscriber && (
            <Link className="btn primary" href={`/livre/${hero.slug}`}>Découvrir « {hero.title} »</Link>
          )}
        </div>
      </section>

      {resume.length > 0 && (
        <section className="stack">
          <h2>Reprendre</h2>
          <BookRows books={resume} progress />
        </section>
      )}

      {home.loading && (
        <section className="stack">
          <Skeleton style={{ height: 20, width: 140 }} />
          <div className="tiles">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="tile"><Skeleton style={{ aspectRatio: '1', borderRadius: 16 }} /><Skeleton style={{ height: 14, width: '80%' }} /></div>)}
          </div>
        </section>
      )}
      {home.error && <ErrorBox error={home.error} onRetry={home.reload} />}

      {home.data && home.data.featured.length > 1 && (
        <section className="stack">
          <h2>À la une</h2>
          <BookTiles books={home.data.featured.slice(1)} />
        </section>
      )}
      {home.data && (
        <section className="stack">
          <h2>Derniers ajouts</h2>
          {home.data.latest.length > 0 ? <BookTiles books={home.data.latest} /> : <EmptyState title="Le catalogue arrive bientôt" icon="📚">Revenez vite, de nouveaux livres sont en préparation.</EmptyState>}
        </section>
      )}
    </div>
  );
}
