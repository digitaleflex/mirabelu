'use client';

declare global {
  interface Window {
    openKkiapayWidget?: (opts: Record<string, unknown>) => void;
    addKkiapayListener?: (event: 'success' | 'failed', cb: (data: { transactionId?: string }) => void) => void;
    removeKkiapayListener?: (event: 'success' | 'failed') => void;
  }
}

const SDK = 'https://cdn.kkiapay.me/k.js';
let loading: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.openKkiapayWidget) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Le module de paiement KKiaPay n’a pas pu être chargé.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export interface KkiapayWidget {
  publicKey: string;
  sandbox: boolean;
  amount: number;
  partnerId: string;
  phone: string;
  name?: string;
}

/** Ouvre le widget et résout avec le `transactionId` ; le serveur le revérifie de toute façon. */
export async function payWithKkiapay(w: KkiapayWidget): Promise<{ transactionId: string } | null> {
  await loadSdk();
  return new Promise((resolve) => {
    window.addKkiapayListener?.('success', (d) => resolve(d.transactionId ? { transactionId: d.transactionId } : null));
    window.addKkiapayListener?.('failed', () => resolve(null));
    window.openKkiapayWidget?.({
      amount: w.amount,
      api_key: w.publicKey,
      sandbox: w.sandbox,
      phone: w.phone.replace(/^\+/, ''),
      name: w.name,
      partnerId: w.partnerId,
      paymentmethod: 'momo',
    });
  });
}
