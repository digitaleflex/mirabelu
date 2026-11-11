'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows } from '@/components/book-list';
import { Empty, ErrorBox, Loading } from '@/components/states';
import { useApi } from '@/lib/use-api';

interface Paged { items: BookSummaryDto[]; total: number; page: number; pageSize: number }
interface Category { id: string; slug: string; name: string }

function Explorer() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('categorie') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;
  const [text, setText] = useState(q);

  // Recherche différée : on n'interroge l'API qu'après une courte pause de frappe.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => navigate({ q: text, page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function navigate(next: { q?: string; categorie?: string; page?: number }) {
    const sp = new URLSearchParams();
    const nq = next.q ?? q;
    const nc = next.categorie ?? category;
    const np = next.page ?? 1;
    if (nq) sp.set('q', nq);
    if (nc) sp.set('categorie', nc);
    if (np > 1) sp.set('page', String(np));
    router.replace(`/explorer${sp.size ? `?${sp}` : ''}`);
  }

  const cats = useApi<Category[]>('/catalog/categories');
  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (q) qs.set('q', q);
  if (category) qs.set('category', category);
  const books = useApi<Paged>(`/catalog/books?${qs}`);

  const pages = books.data ? Math.max(1, Math.ceil(books.data.total / books.data.pageSize)) : 1;
  return (
    <div className="page">
      <div className="page-head"><h1>Explorer</h1></div>
      <div className="field">
        <label htmlFor="q" className="sr-only">Titre ou auteur</label>
        <input id="q" type="search" placeholder="Titre ou auteur" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {cats.data && cats.data.length > 0 && (
        <div className="chips" role="group" aria-label="Catégories">
          <button className="chip" aria-pressed={!category} onClick={() => navigate({ categorie: '' })}>Tout</button>
          {cats.data.map((c) => (
            <button key={c.id} className="chip" aria-pressed={category === c.slug} onClick={() => navigate({ categorie: c.slug })}>{c.name}</button>
          ))}
        </div>
      )}
      {books.loading && <Loading />}
      {books.error && <ErrorBox error={books.error} onRetry={books.reload} />}
      {books.data && books.data.items.length === 0 && (
        <Empty title="Aucun livre trouvé" action={{ href: '/explorer', label: 'Effacer les filtres' }}>Essayez un autre titre, un auteur ou une autre catégorie.</Empty>
      )}
      {books.data && books.data.items.length > 0 && <BookRows books={books.data.items.map((book) => ({ book }))} />}
      {pages > 1 && (
        <div className="cluster" style={{ justifyContent: 'center' }}>
          <button className="btn small" disabled={page <= 1} onClick={() => navigate({ page: page - 1 })}>Précédent</button>
          <span className="muted small">Page {page} sur {pages}</span>
          <button className="btn small" disabled={page >= pages} onClick={() => navigate({ page: page + 1 })}>Suivant</button>
        </div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  return <Suspense fallback={<div className="page"><Loading /></div>}><Explorer /></Suspense>;
}
