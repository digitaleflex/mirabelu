'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ImportDto } from '@mirabelu/contracts';
import { ErrorBox, Loading } from '@/components/states';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Paged { items: ImportDto[]; total: number }
const STATUS: Record<string, string> = { QUEUED: 'En file', RUNNING: 'En cours', SUCCEEDED: 'Terminé', FAILED: 'Échec' };
const STAGE: Record<string, string> = {
  QUEUED: 'en attente', FETCH: 'lecture du fichier', HASH: 'empreinte', PROBE: 'analyse', VALIDATE: 'contrôle', NORMALIZE: 'conversion',
  UPLOAD_ORIGINAL: 'envoi de l’original', UPLOAD_STREAM: 'envoi du format de diffusion', FINALIZE: 'finalisation', DONE: 'terminé',
};

export default function AdminImports() {
  const list = useApi<Paged>('/admin/imports?pageSize=50');
  const [paths, setPaths] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('');
  const cats = useApi<{ slug: string; name: string }[]>('/admin/categories');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const active = list.data?.items.some((i) => i.status === 'QUEUED' || i.status === 'RUNNING');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(list.reload, 4000);
    return () => clearInterval(t);
  }, [active, list.reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = paths.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      await api('/admin/imports/batch', { body: { items: lines.map((sourceRef) => ({ sourceType: 'LOCAL_PATH', sourceRef, ...(author ? { authorName: author } : {}), ...(category ? { categorySlug: category } : {}) })) } });
      setMsg({ kind: 'ok', text: `${lines.length} fichier(s) mis en file.` });
      setPaths('');
      list.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : 'Import impossible.' });
    } finally { setBusy(false); }
  }

  return (
    <div className="page wide">
      <div className="page-head"><h1>Imports</h1><p className="muted">Chaque fichier est converti en AAC mono puis envoyé vers le stockage. Rien n’est publié automatiquement.</p></div>

      <form className="form" style={{ maxWidth: 640 }} onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="paths">Fichiers à importer (un chemin par ligne, relatif au dossier d’import)</label>
          <textarea id="paths" value={paths} onChange={(e) => setPaths(e.target.value)} placeholder={'lot-1/le-pouvoir-des-habitudes.mp3\nlot-1/atomic-habits.m4a'} />
        </div>
        <div className="field"><label htmlFor="ia">Auteur (optionnel, appliqué à tout le lot)</label><input id="ia" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
        <div className="field"><label htmlFor="ic">Catégorie</label>
          <select id="ic" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Première catégorie</option>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
        {msg && <div className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
        <div><button className="btn primary" disabled={busy || !paths.trim()}>{busy ? 'Envoi…' : 'Lancer l’import'}</button></div>
      </form>

      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fichier</th><th>État</th><th>Détail</th><th /></tr></thead>
          <tbody>{list.data.items.map((i) => (
            <tr key={i.id}>
              <td>{i.title ?? i.sourceRef}<br /><span className="muted small">{i.sourceRef}</span></td>
              <td><span className={`pill ${i.status === 'SUCCEEDED' ? 'ok' : i.status === 'FAILED' ? 'bad' : ''}`}>{STATUS[i.status]}</span></td>
              <td className="small">{i.status === 'RUNNING' ? STAGE[i.stage] : i.error ?? ''}</td>
              <td>{i.status === 'FAILED' && <button className="link" onClick={() => void api(`/admin/imports/${i.id}/retry`, { method: 'POST', body: {} }).then(list.reload)}>Relancer</button>}
                {i.status === 'SUCCEEDED' && i.bookId && <a href={`/admin/livres/${i.bookId}`}>Ouvrir</a>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {list.data?.items.length === 0 && <p className="muted">Aucun import pour l’instant.</p>}
    </div>
  );
}
