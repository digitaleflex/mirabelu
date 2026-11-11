'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { BookDetailDto, EssentialsDto } from '@mirabelu/contracts';
import { Cover } from '@/components/cover';
import { HeartIcon, PlayIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Empty, ErrorBox, Loading } from '@/components/states';
import { api, ApiError, fmtClock, fmtDuration } from '@/lib/api';
import { usePlayer } from '@/lib/player';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

type Tab = 'comprendre' | 'appliquer' | 'chapitres';

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { user, isSubscriber } = useSession();
  const player = usePlayer();
  const book = useApi<BookDetailDto>(`/catalog/books/${slug}`);
  const [tab, setTab] = useState<Tab>('chapitres');
  const [msg, setMsg] = useState<string | null>(null);
  const essentials = useApi<EssentialsDto>(isSubscriber && book.data?.hasEssentials && tab !== 'chapitres' ? `/catalog/books/${slug}/essentials` : null);

  if (book.loading && !book.data) return <div className="page"><Loading /></div>;
  if (book.error?.status === 404) return <div className="page"><Empty title="Ce livre n’est pas disponible" action={{ href: '/explorer', label: 'Parcourir le catalogue' }} /></div>;
  if (book.error) return <div className="page"><ErrorBox error={book.error} onRetry={book.reload} /></div>;
  const b = book.data;
  if (!b) return null;

  async function listen(startAt?: number) {
    if (!b) return;
    setMsg(null);
    try {
      await player.play({ book: b, chapters: b.chapters });
      if (startAt !== undefined) player.seek(startAt);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Lecture impossible.');
    }
  }

  async function toggleFavorite() {
    if (!b) return;
    book.setData({ ...b, isFavorite: !b.isFavorite });
    try {
      await api(`/library/favorites/${b.id}`, { method: b.isFavorite ? 'DELETE' : 'PUT' });
    } catch {
      book.setData(b);
    }
  }

  const canListen = isSubscriber;
  const progressPct = b.durationSec > 0 ? Math.round((b.progressSec / b.durationSec) * 100) : 0;

  return (
    <div className="page">
      <section className="hero-book">
        <Cover title={b.title} url={b.coverUrl} />
        <div className="stack">
          <h1>{b.title}</h1>
          <p className="muted">{b.author.name} · {b.category.name} · {fmtDuration(b.durationSec)}</p>
          <div className="cluster">
            {canListen ? (
              <button className="btn primary" onClick={() => void listen()}>
                <PlayIcon />{b.progressSec > 0 ? `Reprendre à ${fmtClock(b.progressSec)}` : 'Écouter'}
              </button>
            ) : user ? (
              <Link className="btn primary" href="/abonnement">S’abonner pour écouter</Link>
            ) : (
              <Link className="btn primary" href={`/connexion?next=/livre/${slug}`}>Se connecter pour écouter</Link>
            )}
            {user && (
              <button className="btn" onClick={() => void toggleFavorite()} aria-pressed={b.isFavorite}>
                <HeartIcon filled={b.isFavorite} />{b.isFavorite ? 'Dans mes favoris' : 'Ajouter aux favoris'}
              </button>
            )}
          </div>
          {progressPct > 0 && <p className="muted small">Écouté à {progressPct} %</p>}
          {msg && <div className="notice error" role="alert">{msg}</div>}
        </div>
      </section>

      {b.description && <p style={{ maxWidth: '62ch' }}>{b.description}</p>}

      <section className="stack">
        <div className="tabs" role="tablist" aria-label="Contenu du livre">
          {(['chapitres', ...(b.hasEssentials ? ['comprendre', 'appliquer'] : [])] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'chapitres' ? 'Chapitres' : t === 'comprendre' ? 'Comprendre' : 'Appliquer'}
            </button>
          ))}
        </div>

        {tab === 'chapitres' && (
          b.chapters.length > 0 ? (
            <ul className="chapters">
              {b.chapters.map((c) => (
                <li key={c.position}>
                  <button disabled={!canListen} onClick={() => void listen(c.startSec)}>
                    <span>{c.title}</span><span className="muted small">{fmtClock(c.startSec)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Ce livre n’est pas découpé en chapitres.</p>
        )}

        {tab !== 'chapitres' && !isSubscriber && (
          <Empty title="Réservé aux abonnés" action={{ href: user ? '/abonnement' : `/connexion?next=/livre/${slug}`, label: user ? 'Voir les formules' : 'Se connecter' }}>
            Les résumés « Comprendre » et « Appliquer » sont inclus dans l’abonnement.
          </Empty>
        )}
        {tab !== 'chapitres' && isSubscriber && essentials.loading && <Loading />}
        {tab !== 'chapitres' && essentials.error && <ErrorBox error={essentials.error} onRetry={essentials.reload} />}
        {tab !== 'chapitres' && essentials.data && <Markdown source={tab === 'comprendre' ? essentials.data.understandMd : essentials.data.applyMd} />}
      </section>
    </div>
  );
}
