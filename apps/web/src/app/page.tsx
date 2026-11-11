'use client';

import Link from 'next/link';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows, BookTiles } from '@/components/book-list';
import { ErrorBox, Loading } from '@/components/states';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Home { featured: BookSummaryDto[]; latest: BookSummaryDto[] }
interface History { items: { book: BookSummaryDto; positionSec: number; completed: boolean }[] }

export default function HomePage() {
  const { user, isSubscriber } = useSession();
  const home = useApi<Home>('/catalog/home');
  const hist = useApi<History>(user ? '/library/history?pageSize=3' : null);

  const resume = hist.data?.items.filter((i) => !i.completed && i.positionSec > 0) ?? [];

  return (
    <div className="page">
      <section className="page-head ripen">
        <h1>Écoutez le livre.<br />Gardez l’essentiel.</h1>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          Des livres complets à écouter partout, et pour chacun, ce qu’il faut comprendre et appliquer dès demain.
        </p>
        {!isSubscriber && (
          <div className="cluster" style={{ marginTop: 12 }}>
            <Link className="btn primary" href="/abonnement">Voir les formules</Link>
            {!user && <Link className="btn" href="/connexion">Se connecter</Link>}
          </div>
        )}
      </section>

      {resume.length > 0 && (
        <section className="stack">
          <h2>Reprendre</h2>
          <BookRows books={resume} progress />
        </section>
      )}

      {home.loading && <Loading />}
      {home.error && <ErrorBox error={home.error} onRetry={home.reload} />}

      {home.data && home.data.featured.length > 0 && (
        <section className="stack">
          <h2>À la une</h2>
          <BookTiles books={home.data.featured} />
        </section>
      )}
      {home.data && (
        <section className="stack">
          <h2>Derniers ajouts</h2>
          {home.data.latest.length > 0 ? <BookTiles books={home.data.latest} /> : <p className="muted">Le catalogue arrive bientôt.</p>}
        </section>
      )}
    </div>
  );
}
