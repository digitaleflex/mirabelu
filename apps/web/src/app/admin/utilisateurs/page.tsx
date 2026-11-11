'use client';

import { useState } from 'react';
import { ErrorBox, Loading } from '@/components/states';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface U { id: string; phone: string; name: string | null; role: string; lastLoginAt: string | null; subscriptionEndsAt: string | null }

export default function AdminUsers() {
  const [q, setQ] = useState('');
  const users = useApi<{ items: U[]; total: number }>(`/admin/users?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function grant(u: U) {
    const reason = window.prompt(`Motif de l’octroi d’un abonnement annuel à ${u.phone} :`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/admin/users/${u.id}/grant`, { body: { plan: 'ANNUAL', reason } });
      setMsg({ kind: 'ok', text: `Abonnement annuel accordé à ${u.phone}.` });
      users.reload();
    } catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Échec.' }); }
  }

  return (
    <div className="page wide">
      <div className="page-head"><h1>Abonnés</h1></div>
      <div className="field" style={{ maxWidth: 360 }}><label htmlFor="uq" className="sr-only">Numéro</label><input id="uq" type="search" placeholder="Rechercher un numéro" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {msg && <div className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
      {users.loading && !users.data && <Loading />}
      {users.error && <ErrorBox error={users.error} onRetry={users.reload} />}
      {users.data && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Numéro</th><th>Nom</th><th>Abonnement</th><th>Dernière connexion</th><th /></tr></thead>
          <tbody>{users.data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.phone}{u.role === 'ADMIN' && <> <span className="pill">admin</span></>}</td>
              <td>{u.name ?? '—'}</td>
              <td>{u.subscriptionEndsAt ? `jusqu’au ${new Date(u.subscriptionEndsAt).toLocaleDateString('fr-FR')}` : '—'}</td>
              <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('fr-FR') : '—'}</td>
              <td><button className="link" onClick={() => void grant(u)}>Offrir 1 an</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
