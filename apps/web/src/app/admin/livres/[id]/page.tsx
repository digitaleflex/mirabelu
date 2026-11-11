'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import { ErrorBox, Loading } from '@/components/states';
import { api, ApiError, fmtDuration } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Detail {
  id: string; slug: string; title: string; description: string; language: string; coverUrl: string | null; isPriority: boolean;
  author: { name: string }; category: { slug: string; name: string };
  status: string; rightsStatus: 'UNVERIFIED' | 'VERIFIED'; rightsNote: string | null; territories: string[]; durationSec: number;
  assets: { kind: string; sizeBytes: number; durationSec: number; bitrateKbps: number | null }[];
  chapters: { position: number; title: string }[];
  essentials: { understandMd: string; applyMd: string; published: boolean } | null;
}

export default function AdminBook({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const book = useApi<Detail>(`/admin/books/${id}`);
  const cats = useApi<{ slug: string; name: string }[]>('/admin/categories');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [meta, setMeta] = useState({ title: '', authorName: '', categorySlug: '', description: '', isPriority: false });
  const [rights, setRights] = useState({ rightsStatus: 'UNVERIFIED' as 'UNVERIFIED' | 'VERIFIED', rightsNote: '', territories: '' });
  const [ess, setEss] = useState({ understandMd: '', applyMd: '', published: false });

  const d = book.data;
  useEffect(() => {
    if (!d) return;
    setMeta({ title: d.title, authorName: d.author.name, categorySlug: d.category.slug, description: d.description, isPriority: d.isPriority });
    setRights({ rightsStatus: d.rightsStatus, rightsNote: d.rightsNote ?? '', territories: d.territories.join(', ') });
    setEss(d.essentials ?? { understandMd: '', applyMd: '', published: false });
  }, [d]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: label }); book.reload(); }
    catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Échec de l’opération.' }); }
  }

  if (book.loading && !d) return <div className="page"><Loading /></div>;
  if (book.error) return <div className="page"><ErrorBox error={book.error} onRetry={book.reload} /></div>;
  if (!d) return null;

  const stream = d.assets.find((a) => a.kind === 'STREAM');
  const territories = rights.territories.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const badTerritory = territories.some((t) => !/^[A-Z]{2}$/.test(t));

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>{d.title}</h1>
        <p className="muted">{d.status === 'PUBLISHED' ? 'Publié' : 'Non publié'} · {fmtDuration(d.durationSec)} · {stream ? `diffusion ${stream.bitrateKbps ?? '?'} kbit/s` : 'pas encore de fichier de diffusion'}</p>
      </div>
      {msg && <div className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}

      <section className="stack">
        <h2>Publication</h2>
        <div className="cluster">
          {d.status === 'PUBLISHED'
            ? <button className="btn" onClick={() => void run('Livre retiré du catalogue.', () => api(`/admin/books/${id}/unpublish`, { method: 'POST', body: {} }))}>Retirer du catalogue</button>
            : <button className="btn primary" onClick={() => void run('Livre publié.', () => api(`/admin/books/${id}/publish`, { method: 'POST', body: {} }))}>Publier</button>}
        </div>
        <p className="muted small">La publication exige des droits vérifiés et un fichier audio de diffusion.</p>
      </section>

      <section className="stack">
        <h2>Droits</h2>
        <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('Droits enregistrés.', () => api(`/admin/books/${id}/rights`, { method: 'PUT', body: { rightsStatus: rights.rightsStatus, rightsNote: rights.rightsNote || null, territories } })); }}>
          <div className="field"><label htmlFor="rs">Statut des droits</label>
            <select id="rs" value={rights.rightsStatus} onChange={(e) => setRights({ ...rights, rightsStatus: e.target.value as 'UNVERIFIED' | 'VERIFIED' })}>
              <option value="UNVERIFIED">À vérifier</option><option value="VERIFIED">Vérifiés</option></select></div>
          <div className="field"><label htmlFor="rn">Preuve ou référence du contrat</label><input id="rn" type="text" value={rights.rightsNote} onChange={(e) => setRights({ ...rights, rightsNote: e.target.value })} /></div>
          <div className="field"><label htmlFor="rt">Pays autorisés (codes ISO, vide = tous)</label><input id="rt" type="text" placeholder="BJ, CI, SN" value={rights.territories} onChange={(e) => setRights({ ...rights, territories: e.target.value })} aria-invalid={badTerritory} />
            {badTerritory && <span className="small" style={{ color: 'var(--alert)' }}>Utilisez des codes à deux lettres.</span>}</div>
          {d.status === 'PUBLISHED' && rights.rightsStatus === 'UNVERIFIED' && <div className="notice error">Enregistrer ainsi retirera ce livre du catalogue.</div>}
          <div><button className="btn dark small" disabled={badTerritory}>Enregistrer les droits</button></div>
        </form>
      </section>

      <section className="stack">
        <h2>Fiche</h2>
        <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('Fiche enregistrée.', () => api(`/admin/books/${id}`, { method: 'PATCH', body: meta })); }}>
          <div className="field"><label htmlFor="mt">Titre</label><input id="mt" type="text" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} required /></div>
          <div className="field"><label htmlFor="ma">Auteur</label><input id="ma" type="text" value={meta.authorName} onChange={(e) => setMeta({ ...meta, authorName: e.target.value })} required /></div>
          <div className="field"><label htmlFor="mc">Catégorie</label>
            <select id="mc" value={meta.categorySlug} onChange={(e) => setMeta({ ...meta, categorySlug: e.target.value })}>
              {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="md">Description</label><textarea id="md" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></div>
          <label className="cluster"><input type="checkbox" checked={meta.isPriority} onChange={(e) => setMeta({ ...meta, isPriority: e.target.checked })} /> Mettre à la une</label>
          <div><button className="btn dark small">Enregistrer la fiche</button></div>
        </form>
      </section>

      <section className="stack">
        <h2>Résumés « Comprendre » et « Appliquer »</h2>
        <form className="form" style={{ maxWidth: 760 }} onSubmit={(e: FormEvent) => { e.preventDefault(); void run('Résumés enregistrés.', () => api(`/admin/books/${id}/essentials`, { method: 'PUT', body: ess })); }}>
          <div className="field"><label htmlFor="eu">Comprendre (Markdown)</label><textarea id="eu" value={ess.understandMd} onChange={(e) => setEss({ ...ess, understandMd: e.target.value })} /></div>
          <div className="field"><label htmlFor="ea">Appliquer (Markdown)</label><textarea id="ea" value={ess.applyMd} onChange={(e) => setEss({ ...ess, applyMd: e.target.value })} /></div>
          <label className="cluster"><input type="checkbox" checked={ess.published} onChange={(e) => setEss({ ...ess, published: e.target.checked })} /> Visible par les abonnés</label>
          <div><button className="btn dark small">Enregistrer les résumés</button></div>
        </form>
      </section>
    </div>
  );
}
