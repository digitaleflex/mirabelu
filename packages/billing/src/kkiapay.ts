import { timingSafeEqual } from 'node:crypto';
import {
  ProviderError,
  type CheckoutContext,
  type CheckoutInit,
  type PaymentProviderAdapter,
  type VerifyExpectation,
  type VerifyResult,
  type WebhookSignal,
} from './types.js';

export interface KkiapayOptions {
  publicKey: string;
  privateKey: string;
  secret: string;
  sandbox: boolean;
  /** Secret partagé attendu dans l'en-tête du webhook (à configurer dans le tableau de bord KKiaPay). */
  webhookSecret?: string;
  webhookHeader?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * KKiaPay : le paiement se fait dans le widget côté client, qui renvoie un `transactionId`.
 * Le serveur vérifie ce `transactionId` auprès de l'API KKiaPay (clés serveur), puis contrôle
 * montant et `partnerId` (= identifiant de paiement Mirabelu). Le webhook ne sert que de déclencheur.
 */
export class KkiapayProvider implements PaymentProviderAdapter {
  readonly code = 'KKIAPAY' as const;
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly o: KkiapayOptions) {
    this.base = (o.baseUrl ?? (o.sandbox ? 'https://api-sandbox.kkiapay.me' : 'https://api.kkiapay.me')).replace(/\/+$/, '');
    this.f = o.fetchImpl ?? fetch;
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutInit> {
    return {
      kind: 'widget',
      widget: {
        publicKey: this.o.publicKey,
        sandbox: this.o.sandbox,
        amount: ctx.amountXof,
        partnerId: ctx.paymentId,
        phone: ctx.user.phone,
        ...(ctx.user.name ? { name: ctx.user.name } : {}),
      },
    };
  }

  async verify(providerRef: string, expected: VerifyExpectation): Promise<VerifyResult> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/api/v1/transactions/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': this.o.publicKey,
          'x-private-key': this.o.privateKey,
          'x-secret-key': this.o.secret,
        },
        body: JSON.stringify({ transactionId: providerRef }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ProviderError(`KKiaPay injoignable : ${(e as Error).message}`, true);
    }
    if (res.status === 404) {
      return { status: 'FAILED', providerRef, amountXof: 0, reason: 'transaction inconnue' };
    }
    if (!res.ok) {
      throw new ProviderError(`KKiaPay status → HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    }
    const tx = (await res.json()) as { status?: string; amount?: number | string; partnerId?: string; transactionId?: string };
    const amount = Number(tx.amount);
    const base = { providerRef, amountXof: Number.isFinite(amount) ? amount : 0 };
    const status = String(tx.status ?? '').toUpperCase();

    if (status === 'SUCCESS') {
      if (base.amountXof !== expected.amountXof) return { ...base, status: 'FAILED', reason: 'montant inattendu' };
      if (tx.partnerId !== expected.paymentId) return { ...base, status: 'FAILED', reason: 'paiement non concordant' };
      return { ...base, status: 'PAID' };
    }
    if (status === 'FAILED') return { ...base, status: 'FAILED', reason: 'refusé' };
    return { ...base, status: 'PENDING' };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookSignal | null {
    const secret = this.o.webhookSecret;
    if (!secret) return null;
    const raw = headers[(this.o.webhookHeader ?? 'x-kkiapay-secret').toLowerCase()];
    const got = Array.isArray(raw) ? raw[0] : raw;
    if (!got) return null;
    const a = Buffer.from(got);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const evt = JSON.parse(rawBody) as { transactionId?: string; partnerId?: string };
      if (!evt.transactionId) return null;
      return { providerRef: String(evt.transactionId), ...(evt.partnerId ? { paymentId: evt.partnerId } : {}) };
    } catch {
      return null;
    }
  }
}
