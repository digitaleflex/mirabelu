import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FedaPayProvider, KkiapayProvider, ProviderError } from '../src/index.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FedaPay', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mk = (responses: Response[], extra = {}) => {
    const queue = [...responses];
    return new FedaPayProvider({
      secretKey: 'sk_test',
      env: 'sandbox',
      webhookSecret: 'whsec',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return queue.shift() as Response;
      }) as typeof fetch,
      now: () => 1_700_000_000,
      ...extra,
    });
  };

  it('crée la transaction puis le jeton, et renvoie une redirection', async () => {
    calls.length = 0;
    const p = mk([json({ 'v1/transaction': { id: 42 } }), json({ token: 't', url: 'https://pay.fedapay.test/t' })]);
    const out = await p.createCheckout({
      paymentId: 'pay1', plan: 'QUARTERLY', amountXof: 7500, user: { phone: '+22900000001' }, returnUrl: 'https://app/return',
    });
    expect(out).toEqual({ kind: 'redirect', url: 'https://pay.fedapay.test/t', providerRef: '42' });
    expect(calls[0]?.url).toBe('https://sandbox-api.fedapay.com/v1/transactions');
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { amount: number; currency: { iso: string }; custom_metadata: { paymentId: string } };
    expect(sent.amount).toBe(7500);
    expect(sent.currency.iso).toBe('XOF');
    expect(sent.custom_metadata.paymentId).toBe('pay1');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });

  it.each([
    ['approved', 7500, 'pay1', 'PAID'],
    ['approved', 100, 'pay1', 'FAILED'], // montant falsifié
    ['approved', 7500, 'autre', 'FAILED'], // transaction d'un autre paiement
    ['pending', 7500, 'pay1', 'PENDING'],
    ['declined', 7500, 'pay1', 'FAILED'],
    ['canceled', 7500, 'pay1', 'CANCELED'],
  ])('verify %s montant=%s paiement=%s → %s', async (status, amount, paymentId, expected) => {
    const p = mk([json({ 'v1/transaction': { id: 42, status, amount, custom_metadata: { paymentId } } })]);
    const r = await p.verify('42', { paymentId: 'pay1', amountXof: 7500 });
    expect(r.status).toBe(expected);
  });

  it('erreur 5xx = réessayable', async () => {
    const p = mk([json({}, 502)]);
    const e = (await p.verify('42', { paymentId: 'x', amountXof: 1 }).catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.retryable).toBe(true);
  });

  describe('webhook', () => {
    const body = JSON.stringify({ name: 'transaction.approved', entity: { id: 42, custom_metadata: { paymentId: 'pay1' } } });
    const sign = (t: number, b: string, secret = 'whsec') => `t=${t},s=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`;
    const p = mk([]);

    it('accepte une signature valide', () => {
      expect(p.parseWebhook({ 'x-fedapay-signature': sign(1_700_000_000, body) }, body)).toEqual({ providerRef: '42', paymentId: 'pay1' });
    });
    it('rejette un mauvais secret, un corps modifié, un horodatage trop ancien, l’absence d’en-tête', () => {
      expect(p.parseWebhook({ 'x-fedapay-signature': sign(1_700_000_000, body, 'autre') }, body)).toBeNull();
      expect(p.parseWebhook({ 'x-fedapay-signature': sign(1_700_000_000, body) }, body + ' ')).toBeNull();
      expect(p.parseWebhook({ 'x-fedapay-signature': sign(1_699_000_000, body) }, body)).toBeNull();
      expect(p.parseWebhook({}, body)).toBeNull();
    });
    it('rejette tout si aucun secret n’est configuré', () => {
      const q = mk([], { webhookSecret: undefined });
      expect(q.parseWebhook({ 'x-fedapay-signature': sign(1_700_000_000, body) }, body)).toBeNull();
    });
  });
});

describe('KKiaPay', () => {
  const mk = (res: Response, extra = {}) => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const p = new KkiapayProvider({
      publicKey: 'pk', privateKey: 'prk', secret: 'sec', sandbox: true, webhookSecret: 'hook',
      fetchImpl: (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return res; }) as typeof fetch,
      ...extra,
    });
    return { p, seen };
  };
  const exp = { paymentId: 'pay1', amountXof: 7500 };

  it('prépare le widget avec partnerId = id de paiement', async () => {
    const { p } = mk(json({}));
    const out = await p.createCheckout({ paymentId: 'pay1', plan: 'ANNUAL', amountXof: 25000, user: { phone: '+22900000001', name: 'Ama' }, returnUrl: 'x' });
    expect(out).toEqual({ kind: 'widget', widget: { publicKey: 'pk', sandbox: true, amount: 25000, partnerId: 'pay1', phone: '+22900000001', name: 'Ama' } });
  });

  it('vérifie côté serveur avec les trois clés', async () => {
    const { p, seen } = mk(json({ status: 'SUCCESS', amount: 7500, partnerId: 'pay1', transactionId: 'T1' }));
    expect((await p.verify('T1', exp)).status).toBe('PAID');
    expect(seen[0]?.url).toBe('https://api-sandbox.kkiapay.me/api/v1/transactions/status');
    const h = seen[0]?.init?.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('pk');
    expect(h['x-private-key']).toBe('prk');
    expect(h['x-secret-key']).toBe('sec');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ transactionId: 'T1' });
  });

  it('refuse montant ou partnerId différents (transaction rejouée sur un autre paiement)', async () => {
    expect((await mk(json({ status: 'SUCCESS', amount: 100, partnerId: 'pay1' })).p.verify('T1', exp)).status).toBe('FAILED');
    expect((await mk(json({ status: 'SUCCESS', amount: 7500, partnerId: 'autre' })).p.verify('T1', exp)).status).toBe('FAILED');
  });

  it('PENDING / FAILED / inconnu', async () => {
    expect((await mk(json({ status: 'PENDING', amount: 7500 })).p.verify('T', exp)).status).toBe('PENDING');
    expect((await mk(json({ status: 'FAILED', amount: 7500 })).p.verify('T', exp)).status).toBe('FAILED');
    expect((await mk(json({}, 404)).p.verify('T', exp)).status).toBe('FAILED');
  });

  it('webhook : secret partagé en temps constant', () => {
    const { p } = mk(json({}));
    const body = JSON.stringify({ transactionId: 'T1', partnerId: 'pay1' });
    expect(p.parseWebhook({ 'x-kkiapay-secret': 'hook' }, body)).toEqual({ providerRef: 'T1', paymentId: 'pay1' });
    expect(p.parseWebhook({ 'x-kkiapay-secret': 'faux' }, body)).toBeNull();
    expect(p.parseWebhook({}, body)).toBeNull();
    expect(p.parseWebhook({ 'x-kkiapay-secret': 'hook' }, 'pas du json')).toBeNull();
  });
});
