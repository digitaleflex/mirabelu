'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { PaymentDto, UserDto } from '@mirabelu/contracts';
import { RequireLogin } from '@/components/guards';
import { api, fmtXof, logout, updateUser } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card } from '@/components/ui';
import { useApi } from '@/lib/use-api';

const STATUS: Record<PaymentDto['status'], string> = { PENDING: 'En attente', PAID: 'Payé', FAILED: 'Refusé', CANCELED: 'Annulé', REFUNDED: 'Remboursé' };

function Account() {
  const router = useRouter();
  const { user, isSubscriber } = useSession();
  const pays = useApi<PaymentDto[]>('/billing/payments');
  const [name, setName] = useState(user?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem('mirabelu-theme');
    const isDark = stored ? stored === 'dark' : true;
    setDark(isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('light', !next);
    localStorage.setItem('mirabelu-theme', next ? 'dark' : 'light');
  }
  if (!user) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const u = await api<UserDto>('/me', { method: 'PATCH', body: { name } });
    updateUser(u);
    setSaved(true);
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Mon compte</h1><p className="muted">{user.phone ?? user.email}</p></div>

      <section className="stack">
        <h2>Abonnement</h2>
        <Card>
          {isSubscriber && user.subscriptionEndsAt ? (
            <p>{user.role === 'ADMIN' ? 'Accès administrateur.' : `Actif jusqu’au ${new Date(user.subscriptionEndsAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}.`}</p>
          ) : <p className="muted">Vous n’avez pas d’abonnement actif.</p>}
          {isSubscriber && user.subscriptionEndsAt && (new Date(user.subscriptionEndsAt).getTime() - Date.now()) < 7 * 86_400_000 && (
            <div className="notice" role="status">Votre abonnement expire bientôt. <Link href="/abonnement">Renouveler maintenant</Link> pour ne pas perdre l’accès.</div>
          )}
          <div><Link className="btn primary" href="/abonnement">{isSubscriber ? 'Prolonger' : 'S’abonner'}</Link></div>
        </Card>
      </section>

      <section className="stack">
        <h2>Votre prénom</h2>
        <form className="form" onSubmit={(e) => void save(e)}>
          <div className="field">
            <label htmlFor="name">Prénom ou nom affiché</label>
            <input id="name" type="text" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </div>
          <div className="cluster"><button className="btn small" disabled={!name.trim()}>Enregistrer</button>{saved && <span role="status" className="muted small">Enregistré</span>}</div>
        </form>
      </section>

      <section className="stack">
        <h2>Paiements</h2>
        {pays.data && pays.data.length === 0 && <p className="muted">Aucun paiement pour le moment.</p>}
        {pays.data && pays.data.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Formule</th><th>Montant</th><th>État</th></tr></thead>
            <tbody>{pays.data.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.createdAt).toLocaleDateString('fr-FR')}</td>
                <td>{p.plan === 'ANNUAL' ? 'Annuelle' : 'Trimestrielle'}</td>
                <td>{fmtXof(p.amountXof)}</td>
                <td><span className={`pill ${p.status === 'PAID' ? 'ok' : p.status === 'PENDING' ? '' : 'bad'}`}>{STATUS[p.status]}</span></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="stack">
        <h2>Apparence</h2>
        <Card>
          <div className="cluster" style={{ justifyContent: 'space-between' }}>
            <span>Mode sombre</span>
            <button className="btn small" onClick={toggleTheme} aria-pressed={dark}>{dark ? 'Activé' : 'Désactivé'}</button>
          </div>
        </Card>
      </section>

      <div className="cluster">
        {user.role === 'ADMIN' && <Link className="btn" href="/admin">Espace administrateur</Link>}
        <button className="btn" onClick={() => { void logout().then(() => router.push('/')); }}>Se déconnecter</button>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return <RequireLogin next="/compte"><Account /></RequireLogin>;
}
