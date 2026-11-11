import type {
  CheckoutContext,
  CheckoutInit,
  PaymentProviderAdapter,
  VerifyExpectation,
  VerifyResult,
  WebhookSignal,
} from './types.js';

/** Prestataire factice — développement et tests uniquement (interdit en production par la config). */
export class MockProvider implements PaymentProviderAdapter {
  readonly code = 'MOCK' as const;

  async createCheckout(_ctx: CheckoutContext): Promise<CheckoutInit> {
    return { kind: 'mock' };
  }

  async verify(providerRef: string, expected: VerifyExpectation): Promise<VerifyResult> {
    // `mock_ok_<id>` = payé ; `mock_fail_<id>` = refusé ; le reste = en attente.
    if (providerRef.startsWith('mock_ok_')) return { status: 'PAID', providerRef, amountXof: expected.amountXof };
    if (providerRef.startsWith('mock_fail_')) return { status: 'FAILED', providerRef, amountXof: 0, reason: 'refus simulé' };
    return { status: 'PENDING', providerRef, amountXof: 0 };
  }

  parseWebhook(): WebhookSignal | null {
    return null;
  }
}
