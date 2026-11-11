import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, seedCatalogBase, type Db } from '@mirabelu/database';
import { createTestDatabase, type TestDatabase } from '@mirabelu/database/testing';
import { AuraStorage } from '@mirabelu/storage';
import { FakeAura } from '@mirabelu/storage/testing';
import { DEFAULT_LIMITS, processImport, type PipelineConfig, type PipelineDeps } from '../src/pipeline.js';

let tdb: TestDatabase;
let db: Db;
let root: string;
let importDir: string;
let workDir: string;
let aura: FakeAura;
let deps: PipelineDeps;
const logs: string[] = [];

const config = (): PipelineConfig => ({
  importDir, workDir, streamBitrateKbps: 64, maxSourceBytes: 50 * 1024 * 1024,
  tools: { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }, ...DEFAULT_LIMITS,
});

function makeTone(path: string, seconds: number, withChapters = false, freq = 330): void {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-ac', '2'];
  if (withChapters) {
    const meta = join(root, 'meta.txt');
    writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=6000\ntitle=Début\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=6000\nEND=15000\ntitle=Suite\n');
    args.push('-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1');
  }
  execFileSync('ffmpeg', [...args, '-b:a', '96k', path]);
}

beforeAll(async () => {
  tdb = await createTestDatabase();
  db = createDb(tdb.url);
  await seedCatalogBase(db);
  root = mkdtempSync(join(tmpdir(), 'worker-'));
  importDir = join(root, 'imports');
  workDir = join(root, 'work');
  mkdirSync(importDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  makeTone(join(importDir, 'Le pouvoir des habitudes.mp3'), 15, true);
  makeTone(join(importDir, 'court.mp3'), 3);
  writeFileSync(join(importDir, 'faux.mp3'), 'ceci est du texte, pas de l’audio');
  mkdirSync(join(importDir, 'sub'));
  copyFileSync(join(importDir, 'court.mp3'), join(importDir, 'sub', 'autre.mp3'));
  makeTone(join(importDir, 'transitoire.mp3'), 12);
  makeTone(join(importDir, 'epuise.mp3'), 12, false, 550);
  writeFileSync(join(root, 'secret.mp3'), 'secret hors répertoire');
  symlinkSync(join(root, 'secret.mp3'), join(importDir, 'lien.mp3'));
});
afterAll(async () => {
  await db.$disconnect();
  await tdb.drop();
  rmSync(root, { recursive: true, force: true });
});

const mkDeps = (a: FakeAura, cfg = config()): PipelineDeps => ({
  db, config: cfg, log: (m) => void logs.push(m),
  storage: new AuraStorage({ apiUrl: a.url, token: a.token, verifyPollMs: 10 }),
});

beforeEach(async () => {
  aura = new FakeAura();
  await aura.start();
  deps = mkDeps(aura);
});

const newJob = (data: { sourceRef: string; sourceType?: 'LOCAL_PATH' | 'AURA_OBJECT'; title?: string; authorName?: string; categorySlug?: string }) =>
  db.importJob.create({ data: { sourceType: data.sourceType ?? 'LOCAL_PATH', sourceRef: data.sourceRef, title: data.title ?? null, authorName: data.authorName ?? null, categorySlug: data.categorySlug ?? null } });

describe('pipeline d’import', () => {
  it('importe un fichier : original + format de diffusion, chapitres, livre prêt (non publié)', async () => {
    const job = await newJob({ sourceRef: 'Le pouvoir des habitudes.mp3', title: 'Le pouvoir des habitudes', authorName: 'Charles Duhigg', categorySlug: 'productivite' });
    await processImport(deps, job.id);

    const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'SUCCEEDED', stage: 'DONE', error: null });
    const book = await db.book.findUniqueOrThrow({ where: { id: done.bookId as string }, include: { assets: true, chapters: { orderBy: { position: 'asc' } }, author: true, category: true } });
    expect(book).toMatchObject({ status: 'READY', rightsStatus: 'UNVERIFIED', slug: 'le-pouvoir-des-habitudes' });
    expect(book.author.name).toBe('Charles Duhigg');
    expect(book.category.slug).toBe('productivite');
    expect(book.durationSec).toBeGreaterThanOrEqual(14);
    expect(book.chapters.map((c) => c.title)).toEqual(['Début', 'Suite']);

    const original = book.assets.find((a) => a.kind === 'ORIGINAL');
    const stream = book.assets.find((a) => a.kind === 'STREAM');
    expect(original?.mimeType).toBe('audio/mpeg');
    expect(stream).toMatchObject({ mimeType: 'audio/mp4' });
    expect(aura.objects.size).toBe(2);
    // Le fichier de diffusion stocké est bien un conteneur MP4/M4A
    const storedStream = aura.objects.get(stream?.auraObjectId as string);
    expect(storedStream?.body?.subarray(4, 8).toString()).toBe('ftyp');
    expect(storedStream?.size).toBe(Number(stream?.sizeBytes));
    // Plus de fichier temporaire
    expect(readdirSync(workDir)).toEqual([]);
  }, 60_000);

  it('est idempotent et dédoublonne un second import du même fichier', async () => {
    const first = await newJob({ sourceRef: 'Le pouvoir des habitudes.mp3', title: 'Le pouvoir des habitudes' });
    await processImport(deps, first.id);
    const booksBefore = await db.book.count();
    const objectsBefore = aura.objects.size;

    await processImport(deps, first.id); // rejeu : rien ne bouge
    expect(await db.book.count()).toBe(booksBefore);

    const second = await newJob({ sourceRef: 'Le pouvoir des habitudes.mp3', title: 'Autre titre' });
    await processImport(deps, second.id);
    const s = await db.importJob.findUniqueOrThrow({ where: { id: second.id } });
    expect(s.status).toBe('SUCCEEDED');
    expect(s.error).toMatch(/Doublon/);
    expect(await db.book.count()).toBe(booksBefore);
    expect(aura.objects.size).toBe(objectsBefore);
  }, 60_000);

  it('refuse un fichier qui n’est pas de l’audio (définitif, sans livre créé)', async () => {
    const before = await db.book.count();
    const job = await newJob({ sourceRef: 'faux.mp3' });
    await processImport(deps, job.id);
    expect(await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED' });
    expect(await db.book.count()).toBe(before);
    expect(aura.objects.size).toBe(0);
  });

  it('refuse un audio trop court', async () => {
    const job = await newJob({ sourceRef: 'court.mp3' });
    await processImport(deps, job.id);
    const j = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe('FAILED');
    expect(j.error).toMatch(/trop court/);
  });

  it('bloque la traversée de répertoire et les liens symboliques sortants', async () => {
    for (const ref of ['../secret.mp3', 'lien.mp3', '/etc/passwd', 'sub/../../secret.mp3']) {
      const job = await newJob({ sourceRef: ref });
      await processImport(deps, job.id);
      const j = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(j.status, ref).toBe('FAILED');
      expect(j.error, ref).toMatch(/hors du répertoire|introuvable/);
    }
    expect(aura.objects.size).toBe(0);
  });

  it('refuse une extension non audio', async () => {
    writeFileSync(join(importDir, 'script.sh'), 'echo hi');
    const job = await newJob({ sourceRef: 'script.sh' });
    await processImport(deps, job.id);
    expect(await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED' });
  });

  it('panne AURA transitoire : remis en file, relancé, sans doublon', async () => {
    const flaky = new FakeAura({ failIntents: 1 });
    await flaky.start();
    const d = mkDeps(flaky);
    const job = await newJob({ sourceRef: 'transitoire.mp3', title: 'Transitoire' });

    await expect(processImport(d, job.id)).rejects.toThrow();
    const mid = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(mid).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(mid.error).toMatch(/Tentative 1\/3/);

    await processImport(d, job.id);
    const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'SUCCEEDED', attempts: 2, error: null });
    expect(await db.book.count({ where: { title: 'Transitoire' } })).toBe(1);
    await flaky.stop();
  }, 60_000);

  it('échoue définitivement après le nombre maximal de tentatives', async () => {
    const down = new FakeAura({ failIntents: 99 });
    await down.start();
    const d = mkDeps(down, { ...config(), maxAttempts: 2 });
    const job = await newJob({ sourceRef: 'epuise.mp3', title: 'Epuise' });
    await expect(processImport(d, job.id)).rejects.toThrow();
    const first = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(first.error).toBeTruthy();
    await processImport(d, job.id); // 2e tentative = dernière : pas d'exception, job FAILED
    expect(await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', attempts: 2 });
    // Le livre créé reste en brouillon, rien n'est publié
    expect(await db.book.findFirstOrThrow({ where: { title: 'Epuise' } })).toMatchObject({ status: 'DRAFT' });
    await down.stop();
  }, 60_000);

  it('importe depuis un objet AURA existant sans recopier l’original', async () => {
    const storage = new AuraStorage({ apiUrl: aura.url, token: aura.token });
    const src = join(importDir, 'sub', 'depuis-aura.mp3');
    makeTone(src, 14, false, 770);
    const { sha256File } = await import('@mirabelu/audio');
    const stored = await storage.uploadFile({
      path: src, displayName: 'depuis-aura.mp3', contentType: 'audio/mpeg', sizeBytes: (await import('node:fs')).statSync(src).size,
      sha256: await sha256File(src), idempotencyKey: 'seed-1',
    });
    const job = await newJob({ sourceType: 'AURA_OBJECT', sourceRef: stored.objectId, title: 'Depuis AURA' });
    await processImport(deps, job.id);
    const j = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.error).toBeNull();
    expect(j.status).toBe('SUCCEEDED');
    const assets = await db.audioAsset.findMany({ where: { bookId: j.bookId as string } });
    expect(assets.find((a) => a.kind === 'ORIGINAL')?.auraObjectId).toBe(stored.objectId);
    expect(aura.objects.size).toBe(2); // l'original d'origine + le format de diffusion uniquement
    expect(existsSync(join(workDir, job.id))).toBe(false);
  }, 60_000);
});
