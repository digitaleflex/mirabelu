import type { PlanCode } from './plans.js';

export type ProviderCode = 'FEDAPAY' | 'KKIAPAY' | 'MOCK';

export interface CheckoutContext {
  paymentId: string;
  plan: PlanCode;
  amountXof: number;
  user: { phone: string; name?: string | null };
  /** URL web vers laquelle le prestataire renvoie l'utilisateur. */
  returnUrl: string;
}

export type CheckoutInit =
  | { kind: 'redirect'; url: string; providerRef?: string }
  | {
      kind: 'widget';
      widget: { publicKey: string; sandbox: boolean; amount: number; partnerId: string; phone: string; name?: string };
    }
  | { kind: 'mock' };

export type VerifyStatus = 'PAID' | 'PENDING' | 'FAILED' | 'CANCELED';

export interface VerifyResult {
  status: VerifyStatus;
  providerRef: string;
  amountXof: number;
  reason?: string;
}

export interface VerifyExpectation {
  paymentId: string;
  amountXof: number;
}

export interface WebhookSignal {
  /** Référence prestataire de la transaction à re-vérifier. */
  providerRef: string;
  /** Identifiant de paiement Mirabelu si le prestataire le renvoie. */
  paymentId?: string;
}

export interface PaymentProviderAdapter {
  readonly code: ProviderCode;
  createCheckout(ctx: CheckoutContext): Promise<CheckoutInit>;
  /**
   * Interroge le prestataire (source de vérité). Ne fait JAMAIS confiance à un corps de requête entrant.
   * Renvoie PAID uniquement si montant ET identifiant de paiement concordent.
   */
  verify(providerRef: string, expected: VerifyExpectation): Promise<VerifyResult>;
  /**
   * Authentifie un webhook entrant et en extrait un signal. Retourne null si la signature est invalide
   * ou le corps inexploitable. Le signal ne vaut pas paiement : il déclenche seulement `verify`.
   */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookSignal | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
