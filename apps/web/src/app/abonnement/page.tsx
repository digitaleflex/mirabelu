'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CheckoutResponse, PaymentDto, PlanDto } from '@mirabelu/contracts';
import { RequireLogin } from '@/components/guards';
import { ErrorBox, Loading } from '@/components/states';
import { api, ApiError, fmtXof, refreshSession } from '@/lib/api';
import { payWithKkiapay } from '@/lib/kkiapay';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const METHODS: Record<string, { label: string; hint: string }> = {
  KKIAPAY: { label: 'Mobile Money (KKiaPay)', hint: 'MTN, Moov, Celtiis… sans quitter le site' },
  FEDAPAY: { label: 'Mobile Money ou carte (FedaPay)', hint: 'Vous serez redirigé vers la page de paiement' },
  MOCK: { label: 'Paiement simulé', hint: 'Environnement de test uniquement' },
};

function Subscribe() {
  const router = useRouter();
  const { user, isSubscriber } = useSession();
  const plans = useApi<PlanDto[]>('/plans');
  const providers = useApi<string[]>('/billing/providers');
  const [plan, setPlan] = useState<'QUARTERLY' | 'ANNUAL'>('ANNUAL');
  const [method, setMethod] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const available = providers.data ?? [];
  const chosen = method || available[0] || '';

  async function waitPaid(paymentId: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      const p = await api<PaymentDto>(`/billing/payments/${paymentId}`);
      if (p.status === 'PAID') return true;
      if (p.status === 'FAILED' || p.status === 'CANCELED') return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async function pay() {
    setBusy(true); setError(null);
    try {
      const co = await api<CheckoutResponse>('/billing/checkout', { body: { plan, provider: chosen } });
      if (co.kind === 'redirect') { window.location.assign(co.url); return; }

      let transactionId: string | undefined;
      if (co.kind === 'widget') {
        const r = await payWithKkiapay(co.widget);
        if (!r) { setError('Le paiement n’a pas abouti. Vous n’avez pas été débité·e, vous pouvez réessayer.'); return; }
        transactionId = r.transactionId;
      } else {
        transactionId = `mock_ok_${co.paymentId}`;
      }
      const p = await api<PaymentDto>(`/billing/payments/${co.paymentId}/confirm`, { body: { transactionId } });
      const ok = p.status === 'PAID' || (p.status === 'PENDING' && (await waitPaid(co.paymentId)));
      if (ok) { await refreshSession(); setDone(true); }
      else setError(p.status === 'PENDING' ? 'Paiement en cours de vérification. Il sera pris en compte dans quelques minutes ; rechargez cette page pour vérifier.' : 'Le paiement a été refusé. Vérifiez votre solde Mobile Money et réessayez.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Paiement impossible.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="page">
        <div className="notice ok" role="status"><h2>Bienvenue, c’est activé.</h2><p>Votre abonnement est en place. Bonne écoute !</p></div>
        <button className="btn primary" onClick={() => router.push('/explorer')}>Choisir un livre</button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{isSubscriber ? 'Prolonger l’abonnement' : 'S’abonner'}</h1>
        {isSubscriber && user?.subscriptionEndsAt && (
          <p className="muted">Actif jusqu’au {new Date(user.subscriptionEndsAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}. Une nouvelle formule s’ajoute à la suite.</p>
        )}
      </div>

      {plans.loading && <Loading />}
      {plans.error && <ErrorBox error={plans.error} onRetry={plans.reload} />}
      <div className="plans" role="group" aria-label="Formules">
        {plans.data?.map((p) => (
          <button key={p.code} className="plan" aria-pressed={plan === p.code} onClick={() => setPlan(p.code)}>
            {p.code === 'ANNUAL' && <span className="badge">Meilleur prix</span>}
            <h3>{p.label}</h3>
            <span className="price">{fmtXof(p.priceXof)}</span>
            <span className="muted small">{p.durationMonths} mois · soit {fmtXof(p.monthlyXof)} par mois</span>
          </button>
        ))}
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="methods">
        <legend className="sr-only">Moyen de paiement</legend>
        <h2>Payer avec</h2>
        {available.length === 0 && !providers.loading && <div className="notice error">Aucun moyen de paiement n’est disponible pour le moment.</div>}
        {available.map((m) => (
          <label key={m} className="method">
            <input type="radio" name="method" checked={chosen === m} onChange={() => setMethod(m)} />
            <span><strong>{METHODS[m]?.label ?? m}</strong><br /><span className="muted small">{METHODS[m]?.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn primary block" disabled={busy || !chosen || !plans.data} onClick={() => void pay()}>
        {busy ? 'Paiement en cours…' : `Payer ${fmtXof(plans.data?.find((p) => p.code === plan)?.priceXof ?? 0)}`}
      </button>
      <p className="muted small">Paiement sécurisé par votre prestataire Mobile Money. Mirabelu ne voit jamais votre code secret.</p>
    </div>
  );
}

export default function SubscribePage() {
  return <RequireLogin next="/abonnement"><Subscribe /></RequireLogin>;
}
