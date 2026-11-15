'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { BookRows } from '@/components/book-list';
import { ErrorBox } from '@/components/states';
import { EmptyState, Skeleton } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Paged { items: BookSummaryDto[]; total: number; page: number; pageSize: number }
interface Category { id: string; slug: string; name: string }

function Explorer() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('categorie') ?? '';
  const [text, setText] = useState(q);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<BookSummaryDto[]>([]);
  const [total, setTotal] = useState(0);

  // Recherche différée
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => navigate({ q: text, page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Reset pagination when filters change
  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [q, category]);

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

  useEffect(() => {
    if (!books.data) return;
    setTotal(books.data.total);
    setItems((prev) => {
      if (page === 1) return books.data!.items;
      const ids = new Set(prev.map((b) => b.id));
      return [...prev, ...books.data!.items.filter((b) => !ids.has(b.id))];
    });
  }, [books.data, page]);

  const pageSize = books.data?.pageSize ?? 20;
  const hasMore = items.length < total;

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
      {books.loading && items.length === 0 && (
        <ul className="rows">{Array.from({ length: 6 }).map((_, i) => <li key={i}><div className="row"><Skeleton style={{ width: 64, height: 64, borderRadius: 12 }} /><div style={{ display: 'grid', gap: 8, flex: 1 }}><Skeleton style={{ height: 16, width: '70%' }} /><Skeleton style={{ height: 12, width: '40%' }} /></div></div></li>)}</ul>
      )}
      {books.error && items.length === 0 && <ErrorBox error={books.error} onRetry={books.reload} />}
      {items.length === 0 && !books.loading && !books.error && (
        <EmptyState title="Aucun livre trouvé" action={{ href: '/explorer', label: 'Effacer les filtres' }} icon="🔍">Essayez un autre titre, un auteur ou une autre catégorie.</EmptyState>
      )}
      {items.length > 0 && <BookRows books={items.map((book) => ({ book }))} />}
      {books.loading && items.length > 0 && (
        <ul className="rows">{Array.from({ length: 3 }).map((_, i) => <li key={i}><div className="row"><Skeleton style={{ width: 64, height: 64, borderRadius: 12 }} /><div style={{ display: 'grid', gap: 8, flex: 1 }}><Skeleton style={{ height: 16, width: '70%' }} /><Skeleton style={{ height: 12, width: '40%' }} /></div></div></li>)}</ul>
      )}
      {hasMore && !books.loading && (
        <div className="cluster" style={{ justifyContent: 'center' }}>
          <button className="btn small" onClick={() => setPage((p) => p + 1)}>Charger plus</button>
          <span className="muted small">{items.length} sur {total}</span>
        </div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  return <Suspense fallback={<div className="page"><p className="muted">Chargement…</p></div>}><Explorer /></Suspense>;
}
