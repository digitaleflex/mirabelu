'use client';

import type { StatsDto } from '@mirabelu/contracts';
import { ErrorBox, Loading } from '@/components/states';
import { fmtXof } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function AdminHome() {
  const stats = useApi<StatsDto>('/admin/stats');
  const s = stats.data;
  return (
    <div className="page wide">
      <div className="page-head"><h1>Tableau de bord</h1><p className="muted">Les 30 derniers jours.</p></div>
      {stats.loading && <Loading />}
      {stats.error && <ErrorBox error={stats.error} onRetry={stats.reload} />}
      {s && (
        <>
          <div className="stats">
            <div className="stat"><strong>{s.activeSubscribers}</strong><span className="muted">abonnés actifs</span></div>
            <div className="stat"><strong>{fmtXof(s.revenueXofLast30Days)}</strong><span className="muted">encaissés</span></div>
            <div className="stat"><strong>{s.newSubscribersLast30Days}</strong><span className="muted">nouveaux abonnés</span></div>
            <div className="stat"><strong>{s.listenedHoursLast30Days} h</strong><span className="muted">d’écoute</span></div>
            <div className="stat"><strong>{s.publishedBooks}</strong><span className="muted">livres publiés</span></div>
          </div>
          <section className="stack">
            <h2>Les plus écoutés</h2>
            {s.topBooks.length === 0 ? <p className="muted">Aucune écoute enregistrée sur la période.</p> : (
              <table className="table"><tbody>{s.topBooks.map((b) => <tr key={b.bookId}><td>{b.title}</td><td>{b.listenedHours} h</td></tr>)}</tbody></table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
