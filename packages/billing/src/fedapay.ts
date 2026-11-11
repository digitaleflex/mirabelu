import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ProviderError,
  type CheckoutContext,
  type CheckoutInit,
  type PaymentProviderAdapter,
  type VerifyExpectation,
  type VerifyResult,
  type WebhookSignal,
} from './types.js';

export interface FedaPayOptions {
  secretKey: string;
  env: 'sandbox' | 'live';
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Tolérance d'horloge de la signature, en secondes. */
  toleranceSeconds?: number;
  now?: () => number;
}

type Json = Record<string, unknown>;

function firstEntity(body: Json, key: string): Json | undefined {
  const v = body[`v1/${key}`] ?? body[key];
  if (Array.isArray(v)) return v[0] as Json | undefined;
  return v && typeof v === 'object' ? (v as Json) : undefined;
}

/**
 * FedaPay : création de transaction + jeton (page hébergée), vérification par relecture de la
 * transaction (statut `approved`), webhook signé `X-FEDAPAY-SIGNATURE: t=<ts>,s=<hmac>`.
 */
export class FedaPayProvider implements PaymentProviderAdapter {
  readonly code = 'FEDAPAY' as const;
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly o: FedaPayOptions) {
    this.base = (o.baseUrl ?? (o.env === 'live' ? 'https://api.fedapay.com' : 'https://sandbox-api.fedapay.com')).replace(/\/+$/, '');
    this.f = o.fetchImpl ?? fetch;
  }

  private async api(method: string, path: string, body?: unknown): Promise<Json> {
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.o.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ProviderError(`FedaPay injoignable : ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      throw new ProviderError(`FedaPay ${method} ${path.replace(/\d+/g, ':id')} → HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    }
    return (await res.json()) as Json;
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutInit> {
    const created = await this.api('POST', '/v1/transactions', {
      description: `Abonnement Mirabelu (${ctx.plan})`,
      amount: ctx.amountXof,
      currency: { iso: 'XOF' },
      callback_url: ctx.returnUrl,
      custom_metadata: { paymentId: ctx.paymentId },
      customer: ctx.user.name ? { firstname: ctx.user.name } : undefined,
    });
    const tx = firstEntity(created, 'transaction');
    const id = tx?.id;
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new ProviderError('FedaPay : réponse de création sans identifiant');
    }
    const tok = await this.api('POST', `/v1/transactions/${encodeURIComponent(String(id))}/token`);
    const url = tok.url;
    if (typeof url !== 'string') throw new ProviderError('FedaPay : réponse de jeton sans URL');
    return { kind: 'redirect', url, providerRef: String(id) };
  }

  async verify(providerRef: string, expected: VerifyExpectation): Promise<VerifyResult> {
    const body = await this.api('GET', `/v1/transactions/${encodeURIComponent(providerRef)}`);
    const tx = firstEntity(body, 'transaction');
    if (!tx) throw new ProviderError('FedaPay : transaction introuvable dans la réponse');
    const status = String(tx.status ?? '');
    const amount = Number(tx.amount);
    const meta = (tx.custom_metadata ?? {}) as Json;
    const result = (s: VerifyResult['status'], reason?: string): VerifyResult => ({
      status: s,
      providerRef,
      amountXof: Number.isFinite(amount) ? amount : 0,
      ...(reason ? { reason } : {}),
    });

    if (status === 'approved' || status === 'transferred') {
      if (amount !== expected.amountXof) return result('FAILED', 'montant inattendu');
      if (meta.paymentId !== expected.paymentId) return result('FAILED', 'paiement non concordant');
      return result('PAID');
    }
    if (status === 'declined' || status === 'refunded') return result('FAILED', status);
    if (status === 'canceled') return result('CANCELED');
    return result('PENDING'); // pending, created…
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookSignal | null {
    const secret = this.o.webhookSecret;
    if (!secret) return null;
    const raw = headers['x-fedapay-signature'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header) return null;

    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
      }),
    );
    const t = parts.t;
    const s = parts.s;
    if (!t || !s || !/^\d+$/.test(t)) return null;

    const now = (this.o.now ?? (() => Date.now() / 1000))();
    if (Math.abs(now - Number(t)) > (this.o.toleranceSeconds ?? 300)) return null;

    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(s);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const evt = JSON.parse(rawBody) as { name?: string; entity?: { id?: number | string; custom_metadata?: { paymentId?: string } } };
      if (!evt.name?.startsWith('transaction.') || evt.entity?.id === undefined) return null;
      const paymentId = evt.entity.custom_metadata?.paymentId;
      return { providerRef: String(evt.entity.id), ...(paymentId ? { paymentId } : {}) };
    } catch {
      return null;
    }
  }
}
