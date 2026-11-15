'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows } from '@/components/book-list';
import { RequireLogin } from '@/components/guards';
import { Empty, ErrorBox, Loading } from '@/components/states';
import { EmptyState, SegmentedControl, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface History { items: { book: BookSummaryDto; positionSec: number; completed: boolean }[] }

function Library() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'cours' | 'favoris' | 'termines' | 'historique'>('cours');
  useEffect(() => {
    const t = params.get('tab');
    if (t === 'favoris' || t === 'termines' || t === 'historique' || t === 'cours') setTab(t);
  }, [params]);
  const hist = useApi<History>('/library/history?pageSize=50');
  const favs = useApi<BookSummaryDto[]>('/library/favorites');

  const items = hist.data?.items ?? [];
  const inProgress = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  return (
    <div className="page">
      <div className="page-head"><h1>Ma bibliothèque</h1></div>
      <SegmentedControl options={[{ value: 'cours', label: 'En cours' }, { value: 'historique', label: 'Historique' }, { value: 'favoris', label: 'Favoris' }, { value: 'termines', label: 'Terminés' }]} value={tab} onChange={setTab} />
      {(hist.loading || favs.loading) && (
        <ul className="rows">{Array.from({ length: 4 }).map((_, i) => <li key={i}><div className="row"><Skeleton style={{ width: 64, height: 64, borderRadius: 12 }} /><div style={{ display: 'grid', gap: 8, flex: 1 }}><Skeleton style={{ height: 16, width: '70%' }} /><Skeleton style={{ height: 12, width: '40%' }} /></div></div></li>)}</ul>
      )}
      {hist.error && <ErrorBox error={hist.error} onRetry={hist.reload} />}
      {tab === 'cours' && !hist.loading && (inProgress.length ? <BookRows books={inProgress} progress /> : <EmptyState title="Rien en cours" action={{ href: '/explorer', label: 'Choisir un livre' }} icon="🎧">Les livres que vous commencez apparaissent ici.</EmptyState>)}
      {tab === 'historique' && !hist.loading && (items.length ? <BookRows books={items} progress /> : <EmptyState title="Aucun historique" action={{ href: '/explorer', label: 'Parcourir' }} icon="🕒">Vos écoutes récentes apparaîtront ici.</EmptyState>)}
      {tab === 'favoris' && !favs.loading && (favs.data?.length ? <BookRows books={favs.data.map((book) => ({ book }))} /> : <EmptyState title="Aucun favori" action={{ href: '/explorer', label: 'Parcourir le catalogue' }} icon="❤️">Touchez « Ajouter aux favoris » sur la page d’un livre.</EmptyState>)}
      {tab === 'termines' && !hist.loading && (done.length ? <BookRows books={done} progress /> : <EmptyState title="Aucun livre terminé" icon="✅">Vos livres terminés seront rangés ici.</EmptyState>)}
    </div>
  );
}

export default function LibraryPage() {
  return <RequireLogin next="/bibliotheque"><Suspense fallback={<div className="page"><p className="muted">Chargement…</p></div>}><Library /></Suspense></RequireLogin>;
}
