'use client';

import { useState } from 'react';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows } from '@/components/book-list';
import { RequireLogin } from '@/components/guards';
import { Empty, ErrorBox, Loading } from '@/components/states';
import { useApi } from '@/lib/use-api';

interface History { items: { book: BookSummaryDto; positionSec: number; completed: boolean }[] }

function Library() {
  const [tab, setTab] = useState<'cours' | 'favoris' | 'termines'>('cours');
  const hist = useApi<History>('/library/history?pageSize=50');
  const favs = useApi<BookSummaryDto[]>('/library/favorites');

  const items = hist.data?.items ?? [];
  const inProgress = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  return (
    <div className="page">
      <div className="page-head"><h1>Ma bibliothèque</h1></div>
      <div className="tabs" role="tablist">
        {([['cours', 'En cours'], ['favoris', 'Favoris'], ['termines', 'Terminés']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {(hist.loading || favs.loading) && <Loading />}
      {hist.error && <ErrorBox error={hist.error} onRetry={hist.reload} />}
      {tab === 'cours' && !hist.loading && (inProgress.length ? <BookRows books={inProgress} progress /> : <Empty title="Rien en cours" action={{ href: '/explorer', label: 'Choisir un livre' }}>Les livres que vous commencez apparaissent ici.</Empty>)}
      {tab === 'favoris' && !favs.loading && (favs.data?.length ? <BookRows books={favs.data.map((book) => ({ book }))} /> : <Empty title="Aucun favori" action={{ href: '/explorer', label: 'Parcourir le catalogue' }}>Touchez « Ajouter aux favoris » sur la page d’un livre.</Empty>)}
      {tab === 'termines' && !hist.loading && (done.length ? <BookRows books={done} progress /> : <Empty title="Aucun livre terminé">Vos livres terminés seront rangés ici.</Empty>)}
    </div>
  );
}

export default function LibraryPage() {
  return <RequireLogin next="/bibliotheque"><Library /></RequireLogin>;
}
