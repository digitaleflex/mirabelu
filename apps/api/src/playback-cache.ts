import type { SignedUrl } from '@mirabelu/storage';

interface Entry {
  value: SignedUrl;
  /** Epoch ms après lequel l'entrée ne doit plus être servie. */
  validUntil: number;
}

/**
 * Cache des URL de lecture par (utilisateur, livre).
 *
 * Chaque preview-intent AURA est comptabilisé comme un téléchargement complet du fichier dans le quota
 * de sortie : sans cache, un lecteur qui renouvelle ou un utilisateur qui recharge la page ferait
 * exploser la consommation. On réutilise donc une URL tant qu'il lui reste une marge confortable, et
 * on mutualise les demandes simultanées (une seule requête AURA en vol par clé).
 *
 * Processus unique (cf. architecture) : pas de cache partagé nécessaire.
 */
export class PlaybackUrlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<SignedUrl>>();

  constructor(
    private readonly maxAgeMs: number,
    /** Marge minimale restante pour réutiliser une URL (le lecteur doit pouvoir finir son tampon). */
    private readonly minRemainingMs = 120_000,
    private readonly maxEntries = 5000,
  ) {}

  async get(key: string, now: number, fetcher: () => Promise<SignedUrl>): Promise<SignedUrl> {
    const hit = this.entries.get(key);
    if (hit && hit.validUntil > now && hit.value.expiresAt * 1000 - now > this.minRemainingMs) {
      return hit.value;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = fetcher()
      .then((value) => {
        const ttl = Math.min(this.maxAgeMs, value.expiresAt * 1000 - now - this.minRemainingMs);
        if (ttl > 0) {
          if (this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
          }
          this.entries.delete(key);
          this.entries.set(key, { value, validUntil: now + ttl });
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
  }
}
