'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Loading } from '@/components/states';
import { useApi } from '@/lib/use-api';

interface Row { id: string; slug: string; title: string; author: { name: string }; category: { name: string }; status: string; rightsStatus: string; durationSec: number }
interface Paged { items: Row[]; total: number }

const STATUS: Record<string, string> = { DRAFT: 'Brouillon', PROCESSING: 'Traitement', READY: 'Prêt', PUBLISHED: 'Publié', UNPUBLISHED: 'Retiré' };

export default function AdminBooks() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ pageSize: '50' });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const books = useApi<Paged>(`/admin/books?${qs}`);
  return (
    <div className="page wide">
      <div className="page-head"><h1>Livres</h1></div>
      <div className="cluster">
        <div className="field" style={{ flex: 1, minWidth: 200 }}><label className="sr-only" htmlFor="aq">Recherche</label><input id="aq" type="search" placeholder="Titre ou auteur" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label className="sr-only" htmlFor="as">État</label>
          <select id="as" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les états</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      {books.loading && <Loading />}
      {books.error && <ErrorBox error={books.error} onRetry={books.reload} />}
      {books.data && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Titre</th><th>Auteur</th><th>État</th><th>Droits</th></tr></thead>
          <tbody>{books.data.items.map((b) => (
            <tr key={b.id}>
              <td><Link href={`/admin/livres/${b.id}`}>{b.title}</Link></td>
              <td>{b.author.name}</td>
              <td><span className={`pill ${b.status === 'PUBLISHED' ? 'ok' : ''}`}>{STATUS[b.status] ?? b.status}</span></td>
              <td><span className={`pill ${b.rightsStatus === 'VERIFIED' ? 'ok' : 'bad'}`}>{b.rightsStatus === 'VERIFIED' ? 'Vérifiés' : 'À vérifier'}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {books.data?.items.length === 0 && <p className="muted">Aucun livre. Lancez un import pour commencer.</p>}
    </div>
  );
}
