'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PaymentDto } from '@mirabelu/contracts';
import { RequireLogin } from '@/components/guards';
import { api, refreshSession } from '@/lib/api';

function Return() {
  const id = useSearchParams().get('paymentId');
  const [status, setStatus] = useState<PaymentDto['status'] | 'ERROR'>('PENDING');

  useEffect(() => {
    if (!id) { setStatus('ERROR'); return; }
    let live = true;
    (async () => {
      for (let i = 0; i < 20 && live; i++) {
        try {
          const p = await api<PaymentDto>(`/billing/payments/${encodeURIComponent(id)}`);
          if (p.status !== 'PENDING') {
            if (live) setStatus(p.status);
            if (p.status === 'PAID') await refreshSession();
            return;
          }
        } catch { /* on réessaie */ }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => { live = false; };
  }, [id]);

  return (
    <div className="page">
      {status === 'PENDING' && <div className="notice" role="status"><h2>Vérification du paiement…</h2><p>Cela prend quelques secondes. Vous pouvez laisser cette page ouverte.</p></div>}
      {status === 'PAID' && <><div className="notice ok" role="status"><h2>Paiement reçu, abonnement activé.</h2></div><Link className="btn primary" href="/explorer">Choisir un livre</Link></>}
      {(status === 'FAILED' || status === 'CANCELED') && <><div className="notice error" role="alert"><h2>Le paiement n’a pas abouti.</h2><p>Vous n’avez pas été débité·e. Vous pouvez réessayer.</p></div><Link className="btn primary" href="/abonnement">Réessayer</Link></>}
      {status === 'ERROR' && <div className="notice error" role="alert">Lien de paiement invalide.</div>}
    </div>
  );
}

export default function ReturnPage() {
  return <RequireLogin next="/abonnement"><Suspense fallback={null}><Return /></Suspense></RequireLogin>;
}
