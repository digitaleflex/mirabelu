import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const list = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** Variables partagées par l'API et le worker. */
const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- AURA Storage -------------------------------------------------------
  /** URL de base de l'API de gestion d'AURA, sans slash final. */
  AURA_API_URL: z.string().url(),
  /** Jeton d'identité machine dédiée : aura_<id>_<secret>. */
  AURA_API_TOKEN: z.string().min(10),
  /** Bucket cible ; vide = bucket par défaut de l'espace. */
  AURA_BUCKET: z.string().optional(),
  /** Durée de validité d'une URL de lecture AURA (secondes), pour calculer le cache. */
  AURA_INTENT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export const apiEnvSchema = base.extend({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Origine publique de l'application web (CORS, redirections de paiement). */
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default(false),
  /** Numéros (E.164) promus administrateurs à la connexion. */
  ADMIN_PHONES: list,
  DEFAULT_PHONE_COUNTRY: z.string().length(2).default('BJ'),

  // --- OTP ----------------------------------------------------------------
  /** console = journalise le code (dev) ; webhook = POST JSON vers OTP_WEBHOOK_URL. */
  OTP_DELIVERY: z.enum(['console', 'webhook']).default('console'),
  OTP_WEBHOOK_URL: z.string().url().optional(),
  OTP_WEBHOOK_TOKEN: z.string().optional(),

  // --- Paiements ----------------------------------------------------------
  /** Prestataires actifs : fedapay, kkiapay, mock (jamais mock en production). */
  PAYMENT_PROVIDERS: list,
  FEDAPAY_SECRET_KEY: z.string().optional(),
  FEDAPAY_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  FEDAPAY_WEBHOOK_SECRET: z.string().optional(),
  KKIAPAY_PUBLIC_KEY: z.string().optional(),
  KKIAPAY_PRIVATE_KEY: z.string().optional(),
  KKIAPAY_SECRET: z.string().optional(),
  KKIAPAY_SANDBOX: bool.default(true),
  /** Secret partagé attendu dans l'en-tête du webhook KKiaPay. */
  KKIAPAY_WEBHOOK_SECRET: z.string().optional(),
  KKIAPAY_WEBHOOK_HEADER: z.string().default('x-kkiapay-secret'),

  PLAYBACK_URL_CACHE_SECONDS: z.coerce.number().int().positive().default(780),
});

export const workerEnvSchema = base.extend({
  /** Répertoire racine autorisé pour les imports depuis le disque. */
  IMPORT_DIR: z.string().default('/data/imports'),
  /** Répertoire temporaire de travail (fichiers téléchargés et convertis). */
  WORK_DIR: z.string().default('/tmp/mirabelu-worker'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Débit AAC cible en kbit/s (mono). */
  STREAM_BITRATE_KBPS: z.coerce.number().int().min(24).max(256).default(64),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** Limite d'un original accepté (octets). */
  MAX_SOURCE_BYTES: z.coerce.number().int().positive().default(5 * 1024 ** 3),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  return result.data;
}

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const env = parse(apiEnvSchema, source);
  if (env.NODE_ENV === 'production') {
    if (env.PAYMENT_PROVIDERS.includes('mock')) {
      throw new Error('Configuration invalide : le prestataire "mock" est interdit en production.');
    }
    if (env.OTP_DELIVERY === 'console') {
      throw new Error('Configuration invalide : OTP_DELIVERY=console est interdit en production.');
    }
    if (!env.COOKIE_SECURE) {
      throw new Error('Configuration invalide : COOKIE_SECURE doit être activé en production.');
    }
  }
  if (env.OTP_DELIVERY === 'webhook' && !env.OTP_WEBHOOK_URL) {
    throw new Error('Configuration invalide : OTP_WEBHOOK_URL est requis avec OTP_DELIVERY=webhook.');
  }
  if (env.PAYMENT_PROVIDERS.includes('fedapay') && !(env.FEDAPAY_SECRET_KEY && env.FEDAPAY_WEBHOOK_SECRET)) {
    throw new Error('Configuration invalide : FEDAPAY_SECRET_KEY et FEDAPAY_WEBHOOK_SECRET sont requis.');
  }
  if (
    env.PAYMENT_PROVIDERS.includes('kkiapay') &&
    !(env.KKIAPAY_PUBLIC_KEY && env.KKIAPAY_PRIVATE_KEY && env.KKIAPAY_SECRET)
  ) {
    throw new Error('Configuration invalide : KKIAPAY_PUBLIC_KEY, KKIAPAY_PRIVATE_KEY et KKIAPAY_SECRET sont requis.');
  }
  return env;
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parse(workerEnvSchema, source);
}
