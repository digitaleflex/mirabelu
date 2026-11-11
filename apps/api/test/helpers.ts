import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { FedaPayProvider, KkiapayProvider, MockProvider, type ProviderRegistry } from '@mirabelu/billing';
import { loadApiEnv, type ApiEnv } from '@mirabelu/config';
import { createDb, seedCatalogBase, type Db } from '@mirabelu/database';
import { createTestDatabase, type TestDatabase } from '@mirabelu/database/testing';
import { InMemoryStorage } from '@mirabelu/storage/testing';
import { buildApp } from '../src/app.js';
import type { OtpSender } from '../src/otp.js';

export class CapturingOtp implements OtpSender {
  codes = new Map<string, string>();
  async send(phone: string, code: string): Promise<void> {
    this.codes.set(phone, code);
  }
}

/** Réponses programmables des faux prestataires. */
export const remote = {
  feda: new Map<string, { status: string; amount: number; paymentId: string }>(),
  kkia: new Map<string, { status: string; amount: number; partnerId: string }>(),
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

export const FEDA_WEBHOOK_SECRET = 'whsec_test';
export const KKIA_WEBHOOK_SECRET = 'kkia_hook_test';

const fedaFetch = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (init?.method === 'POST' && u.pathname === '/v1/transactions') {
    const b = JSON.parse(String(init.body)) as { amount: number; custom_metadata: { paymentId: string } };
    const id = String(1000 + remote.feda.size);
    remote.feda.set(id, { status: 'pending', amount: b.amount, paymentId: b.custom_metadata.paymentId });
    return json({ 'v1/transaction': { id: Number(id) } });
  }
  if (init?.method === 'POST' && u.pathname.endsWith('/token')) return json({ token: 't', url: 'https://pay.fedapay.test/checkout' });
  const m = /\/v1\/transactions\/(\d+)$/.exec(u.pathname);
  const tx = m ? remote.feda.get(m[1] as string) : undefined;
  if (!tx) return json({}, 404);
  return json({ 'v1/transaction': { id: Number(m?.[1]), status: tx.status, amount: tx.amount, custom_metadata: { paymentId: tx.paymentId } } });
}) as typeof fetch;

const kkiaFetch = (async (_url: string, init?: RequestInit) => {
  const { transactionId } = JSON.parse(String(init?.body)) as { transactionId: string };
  const tx = remote.kkia.get(transactionId);
  return tx ? json({ ...tx, transactionId }) : json({}, 404);
}) as typeof fetch;

export function signFeda(body: string, secret = FEDA_WEBHOOK_SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  env: ApiEnv;
  otp: CapturingOtp;
  storage: InMemoryStorage;
  enqueued: string[];
  tdb: TestDatabase;
  close(): Promise<void>;
  login(phone: string): Promise<{ token: string; cookie: string; userId: string }>;
  auth(token: string): Record<string, string>;
}

export async function createHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const tdb = await createTestDatabase();
  const db = createDb(tdb.url);
  const env = loadApiEnv({
    NODE_ENV: 'test',
    DATABASE_URL: tdb.url,
    JWT_SECRET: 'x'.repeat(40),
    AURA_API_URL: 'http://aura.test',
    AURA_API_TOKEN: 'aura_test_secret',
    ADMIN_PHONES: '+2290100000099',
    PAYMENT_PROVIDERS: 'fedapay,kkiapay,mock',
    FEDAPAY_SECRET_KEY: 'sk_test',
    FEDAPAY_WEBHOOK_SECRET: FEDA_WEBHOOK_SECRET,
    KKIAPAY_PUBLIC_KEY: 'pk',
    KKIAPAY_PRIVATE_KEY: 'prk',
    KKIAPAY_SECRET: 'sec',
    KKIAPAY_WEBHOOK_SECRET: KKIA_WEBHOOK_SECRET,
    LOG_LEVEL: 'silent',
    ...extraEnv,
  });
  await seedCatalogBase(db);

  const providers: ProviderRegistry = {
    FEDAPAY: new FedaPayProvider({ secretKey: 'sk_test', env: 'sandbox', webhookSecret: FEDA_WEBHOOK_SECRET, fetchImpl: fedaFetch }),
    KKIAPAY: new KkiapayProvider({ publicKey: 'pk', privateKey: 'prk', secret: 'sec', sandbox: true, webhookSecret: KKIA_WEBHOOK_SECRET, fetchImpl: kkiaFetch }),
    MOCK: new MockProvider(),
  };
  const otp = new CapturingOtp();
  const storage = new InMemoryStorage();
  const enqueued: string[] = [];
  const app = await buildApp({
    env, db, storage, providers, otp,
    queue: { enqueueImport: async (j) => { enqueued.push(j.importJobId); } },
  });
  await app.ready();

  const h: Harness = {
    app, db, env, otp, storage, enqueued, tdb,
    async close() {
      await app.close();
      await db.$disconnect();
      await tdb.drop();
    },
    auth: (token) => ({ authorization: `Bearer ${token}` }),
    async login(phone) {
      // Pas de limite de 30 s entre deux connexions successives dans les tests.
      await db.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
      const r = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
      if (r.statusCode !== 200) throw new Error(`otp/request ${r.statusCode} ${r.body}`);
      const normalized = (r.json() as { phone: string }).phone;
      const code = otp.codes.get(normalized) as string;
      const v = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } });
      if (v.statusCode !== 200) throw new Error(`otp/verify ${v.statusCode} ${v.body}`);
      const body = v.json() as { accessToken: string; user: { id: string } };
      const cookie = String(v.cookies.find((c) => c.name === 'mb_refresh')?.value);
      return { token: body.accessToken, cookie, userId: body.user.id };
    },
  };
  return h;
}

/** Livre publié complet (droits vérifiés + fichier de diffusion). */
export async function seedPublishedBook(h: Harness, opts: { slug?: string; title?: string; territories?: string[]; publish?: boolean } = {}) {
  const category = await h.db.category.findFirstOrThrow();
  const slug = opts.slug ?? 'atomic-habits';
  const author = await h.db.author.upsert({ where: { slug: 'james-clear' }, create: { name: 'James Clear', slug: 'james-clear' }, update: {} });
  const objectId = `obj-${slug}`;
  h.storage.objects.set(objectId, { sha256: slug.padEnd(64, '0'), sizeBytes: 5_000_000, path: objectId });
  return h.db.book.create({
    data: {
      slug, title: opts.title ?? 'Atomic Habits', authorId: author.id, categoryId: category.id, durationSec: 3600,
      status: opts.publish === false ? 'READY' : 'PUBLISHED', rightsStatus: 'VERIFIED', publishedAt: new Date(),
      territories: opts.territories ?? [],
      assets: { create: { kind: 'STREAM', auraObjectId: objectId, sha256: slug.padEnd(64, '0'), sizeBytes: 5_000_000n, durationSec: 3600, mimeType: 'audio/mp4', bitrateKbps: 64 } },
      chapters: { create: [{ position: 1, title: 'Introduction', startSec: 0, endSec: 600 }] },
      essentials: { create: { understandMd: '## Comprendre', applyMd: '## Appliquer', published: true } },
    },
  });
}
