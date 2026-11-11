/**
 * Pile de démonstration / de test de bout en bout, sans services externes :
 * PostgreSQL de test + faux AURA + API Mirabelu + un livre réellement importé par le pipeline (ffmpeg).
 *
 *   pnpm --filter @mirabelu/e2e stack     # puis lancer le site web avec API_URL=http://127.0.0.1:4000
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '@mirabelu/api/app';
import { FedaPayProvider, MockProvider } from '@mirabelu/billing';
import { loadApiEnv } from '@mirabelu/config';
import { createDb, seedCatalogBase } from '@mirabelu/database';
import { createTestDatabase } from '@mirabelu/database/testing';
import { AuraStorage } from '@mirabelu/storage';
import { FakeAura } from '@mirabelu/storage/testing';
import { DEFAULT_LIMITS, processImport } from '@mirabelu/worker/pipeline';

const OTP_FILE = process.env.E2E_OTP_FILE ?? join(tmpdir(), 'mirabelu-e2e-otp.json');
const PORT = Number(process.env.E2E_API_PORT ?? 4000);

const tdb = await createTestDatabase();
const db = createDb(tdb.url);
const aura = new FakeAura();
await aura.start();
await seedCatalogBase(db);

const root = mkdtempSync(join(tmpdir(), 'mirabelu-e2e-'));
const importDir = join(root, 'imports');
mkdirSync(importDir, { recursive: true });
const meta = join(root, 'meta.txt');
writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=20000\ntitle=Introduction\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=20000\nEND=60000\ntitle=Les quatre lois\n');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=261:duration=60', '-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-b:a', '96k', join(importDir, 'habitudes.mp3')]);

const storage = new AuraStorage({ apiUrl: aura.url, token: aura.token, verifyPollMs: 20 });
const job = await db.importJob.create({
  data: { sourceType: 'LOCAL_PATH', sourceRef: 'habitudes.mp3', title: 'Le pouvoir des habitudes', authorName: 'Charles Duhigg', categorySlug: 'productivite' },
});
await processImport(
  {
    db, storage, log: () => undefined,
    config: { importDir, workDir: join(root, 'work'), streamBitrateKbps: 64, maxSourceBytes: 1 << 30, tools: { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }, ...DEFAULT_LIMITS },
  },
  job.id,
);
const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
if (done.status !== 'SUCCEEDED' || !done.bookId) throw new Error(`import e2e en échec : ${done.error}`);
await db.book.update({ where: { id: done.bookId }, data: { rightsStatus: 'VERIFIED', status: 'PUBLISHED', publishedAt: new Date(), description: 'Pourquoi nous faisons ce que nous faisons, et comment changer.', isPriority: true } });
await db.bookEssentials.create({
  data: {
    bookId: done.bookId, published: true,
    understandMd: '## Comprendre\n\nUne habitude suit toujours la même boucle : **signal**, **routine**, **récompense**.\n\n- Le signal déclenche le comportement\n- La routine est le comportement lui-même\n- La récompense dit au cerveau de recommencer',
    applyMd: '## Appliquer\n\n1. Choisissez *une* habitude à changer\n2. Repérez son signal\n3. Gardez le signal, changez la routine',
  },
});

const env = loadApiEnv({
  NODE_ENV: 'development', PORT: String(PORT), HOST: '127.0.0.1', DATABASE_URL: tdb.url, JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123',
  AURA_API_URL: aura.url, AURA_API_TOKEN: aura.token, WEB_ORIGIN: 'http://localhost:3000', REFRESH_COOKIE_PATH: '/api/auth',
  ADMIN_PHONES: '+2290100000099', PAYMENT_PROVIDERS: 'mock', LOG_LEVEL: 'warn',
});
void FedaPayProvider;
const app = await buildApp({
  env, db, storage, providers: { MOCK: new MockProvider() },
  otp: { async send(phone, code) { writeFileSync(OTP_FILE, JSON.stringify({ phone, code })); } },
  queue: { async enqueueImport() { /* pas de worker dans cette pile */ } },
});
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`E2E_READY api=http://127.0.0.1:${PORT} otp=${OTP_FILE} book=${done.bookId}`);

const stop = async () => { await app.close(); await db.$disconnect(); await aura.stop(); await tdb.drop(); process.exit(0); };
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
