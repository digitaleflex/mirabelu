export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Développement uniquement : écrit le code dans les journaux. */
export class ConsoleOtpSender implements OtpSender {
  constructor(private readonly log: (msg: string) => void) {}
  async send(phone: string, code: string): Promise<void> {
    this.log(`[OTP dev] ${phone} → ${code}`);
  }
}

/**
 * Envoie le code par une passerelle HTTP (SMS / WhatsApp) : POST JSON { phone, code, message }.
 * La passerelle est choisie par l'exploitant (voir docs/operations.md).
 */
export class WebhookOtpSender implements OtpSender {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phone: string, code: string): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        phone,
        code,
        message: `Mirabelu : votre code de connexion est ${code}. Il expire dans 10 minutes.`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Passerelle OTP : HTTP ${res.status}`);
  }
}
