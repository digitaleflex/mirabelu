import { z } from 'zod';

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------
export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug invalide (minuscules, chiffres et tirets)');

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

export const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiError>;

// ---------------------------------------------------------------------------
// Authentification (téléphone + OTP)
// ---------------------------------------------------------------------------
export const requestOtpBody = z.object({ phone: z.string().min(6).max(24) });
export const verifyOtpBody = z.object({
  phone: z.string().min(6).max(24),
  code: z.string().regex(/^\d{6}$/, 'le code comporte 6 chiffres'),
});
export const userRole = z.enum(['SUBSCRIBER', 'ADMIN']);
export const userDto = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  role: userRole,
  subscriptionEndsAt: z.string().nullable(),
});
export type UserDto = z.infer<typeof userDto>;
export const updateProfileBody = z.object({ name: z.string().trim().min(1).max(80) });

// ---------------------------------------------------------------------------
// Abonnements et paiements
// ---------------------------------------------------------------------------
export const planCode = z.enum(['QUARTERLY', 'ANNUAL']);
export type PlanCode = z.infer<typeof planCode>;
export const providerCode = z.enum(['FEDAPAY', 'KKIAPAY', 'MOCK']);
export type ProviderCode = z.infer<typeof providerCode>;

export const planDto = z.object({
  code: planCode,
  label: z.string(),
  priceXof: z.number().int(),
  durationMonths: z.number().int(),
  monthlyXof: z.number().int(),
});
export type PlanDto = z.infer<typeof planDto>;

export const checkoutBody = z.object({ plan: planCode, provider: providerCode });
export const kkiapayWidget = z.object({
  publicKey: z.string(),
  sandbox: z.boolean(),
  amount: z.number().int(),
  partnerId: z.string(),
  phone: z.string(),
  name: z.string().optional(),
});
export const checkoutResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('redirect'), paymentId: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('widget'), paymentId: z.string(), widget: kkiapayWidget }),
  z.object({ kind: z.literal('mock'), paymentId: z.string() }),
]);
export type CheckoutResponse = z.infer<typeof checkoutResponse>;

export const confirmPaymentBody = z.object({ transactionId: z.string().min(1).max(128) });

export const paymentStatus = z.enum(['PENDING', 'PAID', 'FAILED', 'CANCELED']);
export const paymentDto = z.object({
  id: z.string(),
  plan: planCode,
  provider: z.string(),
  amountXof: z.number().int(),
  status: paymentStatus,
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type PaymentDto = z.infer<typeof paymentDto>;

export const subscriptionDto = z.object({
  id: z.string(),
  plan: planCode,
  status: z.enum(['ACTIVE', 'CANCELED']),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDto>;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const categoryDto = z.object({ id: z.string(), slug: z.string(), name: z.string() });
export const authorDto = z.object({ id: z.string(), slug: z.string(), name: z.string() });

export const bookSummaryDto = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  author: authorDto,
  category: categoryDto,
  language: z.string(),
  durationSec: z.number().int(),
  coverUrl: z.string().nullable(),
  hasEssentials: z.boolean(),
});
export type BookSummaryDto = z.infer<typeof bookSummaryDto>;

export const chapterDto = z.object({
  position: z.number().int(),
  title: z.string(),
  startSec: z.number().int(),
  endSec: z.number().int(),
});
export type ChapterDto = z.infer<typeof chapterDto>;

export const bookDetailDto = bookSummaryDto.extend({
  description: z.string(),
  chapters: z.array(chapterDto),
  isFavorite: z.boolean(),
  progressSec: z.number().int(),
  /** Vrai si l'utilisateur peut écouter et lire les résumés. */
  canListen: z.boolean(),
});
export type BookDetailDto = z.infer<typeof bookDetailDto>;

export const catalogQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  category: slug.optional(),
});

export const essentialsDto = z.object({
  understandMd: z.string(),
  applyMd: z.string(),
});
export type EssentialsDto = z.infer<typeof essentialsDto>;

// ---------------------------------------------------------------------------
// Lecture et bibliothèque personnelle
// ---------------------------------------------------------------------------
export const playbackResponse = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  durationSec: z.number().int(),
  resumeAtSec: z.number().int(),
});
export type PlaybackResponse = z.infer<typeof playbackResponse>;

export const progressBody = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 200),
  completed: z.boolean().optional(),
  /** Secondes écoutées depuis le dernier envoi (statistiques d'écoute). */
  listenedSec: z.number().int().min(0).max(3600).optional(),
});
export const bookmarkBody = z.object({
  positionSec: z.number().int().min(0),
  note: z.string().trim().max(240).optional(),
});
export const bookmarkDto = z.object({
  id: z.string(),
  bookId: z.string(),
  positionSec: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export const historyItemDto = z.object({
  book: bookSummaryDto,
  positionSec: z.number().int(),
  completed: z.boolean(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
export const adminBookBody = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slug.optional(),
  authorName: z.string().trim().min(1).max(120),
  categorySlug: slug,
  description: z.string().max(5000).default(''),
  language: z.string().min(2).max(8).default('fr'),
  coverUrl: z.string().url().nullable().optional(),
  isPriority: z.boolean().default(false),
});
export const adminBookPatch = adminBookBody.partial();

export const rightsBody = z.object({
  rightsStatus: z.enum(['UNVERIFIED', 'VERIFIED']),
  rightsNote: z.string().max(2000).nullable().optional(),
  territories: z.array(z.string().length(2)).max(250).default([]),
});

export const essentialsBody = z.object({
  understandMd: z.string().max(60_000).default(''),
  applyMd: z.string().max(60_000).default(''),
  published: z.boolean().default(false),
});

export const adminCategoryBody = z.object({
  slug,
  name: z.string().trim().min(1).max(80),
  position: z.number().int().default(0),
});

export const importSourceType = z.enum(['LOCAL_PATH', 'AURA_OBJECT']);
export const importCreateBody = z.object({
  sourceType: importSourceType,
  /** Chemin relatif à IMPORT_DIR, ou identifiant d'objet AURA. */
  sourceRef: z.string().min(1).max(1024),
  title: z.string().trim().min(1).max(200).optional(),
  authorName: z.string().trim().min(1).max(120).optional(),
  categorySlug: slug.optional(),
  bookId: z.string().optional(),
});
export const importBatchBody = z.object({ items: z.array(importCreateBody).min(1).max(500) });
export const importDto = z.object({
  id: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  stage: z.string(),
  sourceType: importSourceType,
  sourceRef: z.string(),
  bookId: z.string().nullable(),
  title: z.string().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImportDto = z.infer<typeof importDto>;

export const grantSubscriptionBody = z.object({
  plan: planCode,
  reason: z.string().trim().min(3).max(200),
});

export const statsDto = z.object({
  activeSubscribers: z.number().int(),
  revenueXofLast30Days: z.number().int(),
  newSubscribersLast30Days: z.number().int(),
  listenedHoursLast30Days: z.number(),
  publishedBooks: z.number().int(),
  topBooks: z.array(z.object({ bookId: z.string(), title: z.string(), listenedHours: z.number() })),
});
export type StatsDto = z.infer<typeof statsDto>;

/** Slug ASCII minuscule à partir d'un texte libre (accents retirés). */
export function slugify(input: string): string {
  const s = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return s || 'sans-titre';
}
