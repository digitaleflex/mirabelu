import type { ApiEnv } from '@mirabelu/config';
import { FedaPayProvider } from './fedapay.js';
import { KkiapayProvider } from './kkiapay.js';
import { MockProvider } from './mock.js';
import type { PaymentProviderAdapter, ProviderCode } from './types.js';

export type ProviderRegistry = Partial<Record<ProviderCode, PaymentProviderAdapter>>;

/** Construit les prestataires activés par PAYMENT_PROVIDERS (la config a déjà validé les clés requises). */
export function createProviders(env: ApiEnv): ProviderRegistry {
  const reg: ProviderRegistry = {};
  for (const name of env.PAYMENT_PROVIDERS) {
    if (name === 'fedapay') {
      reg.FEDAPAY = new FedaPayProvider({
        secretKey: env.FEDAPAY_SECRET_KEY as string,
        env: env.FEDAPAY_ENV,
        ...(env.FEDAPAY_WEBHOOK_SECRET ? { webhookSecret: env.FEDAPAY_WEBHOOK_SECRET } : {}),
      });
    } else if (name === 'kkiapay') {
      reg.KKIAPAY = new KkiapayProvider({
        publicKey: env.KKIAPAY_PUBLIC_KEY as string,
        privateKey: env.KKIAPAY_PRIVATE_KEY as string,
        secret: env.KKIAPAY_SECRET as string,
        sandbox: env.KKIAPAY_SANDBOX,
        ...(env.KKIAPAY_WEBHOOK_SECRET ? { webhookSecret: env.KKIAPAY_WEBHOOK_SECRET } : {}),
        webhookHeader: env.KKIAPAY_WEBHOOK_HEADER,
      });
    } else if (name === 'mock') {
      reg.MOCK = new MockProvider();
    }
  }
  return reg;
}
