import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { AudioError, normalizeToStream, probe, sha256File, type AudioTools } from '@mirabelu/audio';
import { slugify } from '@mirabelu/contracts';
import type { Db } from '@mirabelu/database';
import { StorageError, type ObjectStorage } from '@mirabelu/storage';
import { ImportError, contentTypeFor, downloadToFile, resolveImportPath } from './source.js';

export interface PipelineConfig {
  importDir: string;
  workDir: string;
  streamBitrateKbps: number;
  maxSourceBytes: number;
  /** Nombre maximal de tentatives avant échec définitif. */
  maxAttempts: number;
  tools: AudioTools;
  /** Durées mini/maxi acceptées d'un livre audio. */
  minDurationSec: number;
  maxDurationSec: number;
}

export interface PipelineDeps {
  db: Db;
  storage: ObjectStorage;
  config: PipelineConfig;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_LIMITS = { minDurationSec: 10, maxDurationSec: 100 * 3600, maxAttempts: 3 } as const;

type Stage =
  | 'FETCH' | 'HASH' | 'PROBE' | 'VALIDATE' | 'NORMALIZE' | 'UPLOAD_ORIGINAL' | 'UPLOAD_STREAM' | 'FINALIZE';

/**
 * Traite un ImportJob de bout en bout. Idempotent et reprenable :
 * - un job déjà réussi est ignoré ;
 * - le livre et les actifs déjà créés sont réutilisés (clés d'idempotence AURA stables) ;
 * - une erreur définitive (fichier invalide) marque le job FAILED sans nouvelle tentative ;
 * - une erreur transitoire (AURA indisponible…) remet le job en file et relance l'exception pour pg-boss,
 *   jusqu'à `maxAttempts`.
 */
export async function processImport(deps: PipelineDeps, importJobId: string): Promise<void> {
  const { db, config, log } = deps;
  const job = await db.importJob.findUnique({ where: { id: importJobId } });
  if (!job) {
    log('import introuvable, ignoré', { importJobId });
    return;
  }
  if (job.status === 'SUCCEEDED') return;

  const attempt = job.attempts + 1;
  await db.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING', attempts: attempt, error: null, finishedAt: null } });
  const setStage = (stage: Stage) => db.importJob.update({ where: { id: job.id }, data: { stage } });

  const workDir = join(config.workDir, job.id);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  let touchedBookId: string | null = job.bookId;
  try {
    // 1. FETCH -----------------------------------------------------------------------------------
    await setStage('FETCH');
    let originalPath: string;
    let originalSize: number;
    let originalSha: string | undefined;
    let originalObjectId: string | undefined;
    let originalName: string;

    if (job.sourceType === 'LOCAL_PATH') {
      const r = await resolveImportPath(config.importDir, job.sourceRef, config.maxSourceBytes);
      originalPath = r.path;
      originalSize = r.sizeBytes;
      originalName = basename(r.path);
    } else {
      const signed = await deps.storage.downloadUrl(job.sourceRef);
      originalName = `${job.sourceRef}.bin`;
      originalPath = join(workDir, 'source');
      const d = await downloadToFile(signed.url, originalPath, config.maxSourceBytes, deps.fetchImpl);
      originalSize = d.sizeBytes;
      originalSha = d.sha256;
      originalObjectId = job.sourceRef;
    }

    // 2. HASH + dédoublonnage ----------------------------------------------------------------------
    await setStage('HASH');
    originalSha ??= await sha256File(originalPath);
    await db.importJob.update({ where: { id: job.id }, data: { sha256: originalSha } });

    const duplicate = await db.audioAsset.findFirst({ where: { kind: 'ORIGINAL', sha256: originalSha } });
    if (duplicate && duplicate.bookId !== job.bookId) {
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED', stage: 'DONE', bookId: duplicate.bookId, finishedAt: new Date(),
          error: 'Doublon : ce fichier a déjà été importé, aucun nouveau livre créé.',
        },
      });
      return;
    }

    // 3. PROBE + VALIDATE -----------------------------------------------------------------------------
    await setStage('PROBE');
    const sourceProbe = await probe(originalPath, config.tools);
    await setStage('VALIDATE');
    if (sourceProbe.durationSec < config.minDurationSec) {
      throw new ImportError(`Audio trop court (${sourceProbe.durationSec} s)`, true);
    }
    if (sourceProbe.durationSec > config.maxDurationSec) {
      throw new ImportError(`Audio trop long (${Math.round(sourceProbe.durationSec / 3600)} h)`, true);
    }

    // 4. NORMALIZE ---------------------------------------------------------------------------------------
    await setStage('NORMALIZE');
    const streamPath = join(workDir, 'stream.m4a');
    await normalizeToStream(originalPath, streamPath, { bitrateKbps: config.streamBitrateKbps }, config.tools);
    const streamProbe = await probe(streamPath, config.tools);
    const streamSha = await sha256File(streamPath);
    const streamSize = (await stat(streamPath)).size;

    // 5. Livre (créé en PROCESSING avant tout envoi, pour qu'un échec laisse une trace visible) -----------
    const bookId = job.bookId ?? (await createBookFor(db, job, originalName)).id;
    touchedBookId = bookId;
    if (!job.bookId) await db.importJob.update({ where: { id: job.id }, data: { bookId } });
    await db.book.update({ where: { id: bookId }, data: { status: 'PROCESSING' } });

    // 6. UPLOAD_ORIGINAL ------------------------------------------------------------------------------------
    await setStage('UPLOAD_ORIGINAL');
    const hasOriginal = await db.audioAsset.findUnique({ where: { bookId_kind: { bookId, kind: 'ORIGINAL' } } });
    if (!hasOriginal) {
      let objectId = originalObjectId;
      if (!objectId) {
        const stored = await deps.storage.uploadFile({
          path: originalPath,
          displayName: originalName,
          contentType: contentTypeFor(originalPath),
          sizeBytes: originalSize,
          sha256: originalSha,
          idempotencyKey: `import-${job.id}-original`,
        });
        objectId = stored.objectId;
      }
      await db.audioAsset.create({
        data: {
          bookId, kind: 'ORIGINAL', auraObjectId: objectId, sha256: originalSha, sizeBytes: BigInt(originalSize),
          durationSec: sourceProbe.durationSec, mimeType: AUDIO_MIME(originalName), bitrateKbps: sourceProbe.bitrateKbps,
        },
      });
    }

    // 7. UPLOAD_STREAM -----------------------------------------------------------------------------------------
    await setStage('UPLOAD_STREAM');
    const hasStream = await db.audioAsset.findUnique({ where: { bookId_kind: { bookId, kind: 'STREAM' } } });
    if (!hasStream) {
      const stored = await deps.storage.uploadFile({
        path: streamPath,
        displayName: `${slugify(basename(originalName, extname(originalName)))}.m4a`,
        contentType: 'audio/mp4',
        sizeBytes: streamSize,
        sha256: streamSha,
        idempotencyKey: `import-${job.id}-stream`,
      });
      await db.audioAsset.create({
        data: {
          bookId, kind: 'STREAM', auraObjectId: stored.objectId, sha256: streamSha, sizeBytes: BigInt(streamSize),
          durationSec: streamProbe.durationSec, mimeType: 'audio/mp4', bitrateKbps: streamProbe.bitrateKbps ?? config.streamBitrateKbps,
        },
      });
    }

    // 8. FINALIZE ---------------------------------------------------------------------------------------------------
    await setStage('FINALIZE');
    const chapters = streamProbe.chapters.length > 0 ? streamProbe.chapters : sourceProbe.chapters;
    await db.$transaction(async (tx) => {
      await tx.chapter.deleteMany({ where: { bookId } });
      if (chapters.length > 0) {
        await tx.chapter.createMany({
          data: chapters.map((c, i) => ({ bookId, position: i + 1, title: c.title, startSec: c.startSec, endSec: Math.max(c.endSec, c.startSec) })),
        });
      }
      // Jamais publié automatiquement : les droits restent à vérifier par un humain.
      await tx.book.update({ where: { id: bookId }, data: { durationSec: streamProbe.durationSec, status: 'READY' } });
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', stage: 'DONE', finishedAt: new Date(), error: null } });
    });
    log('import terminé', { importJobId: job.id, bookId });
  } catch (err) {
    const permanent =
      (err instanceof ImportError && err.permanent) || (err instanceof AudioError && err.permanent) ||
      (err instanceof StorageError && !err.retryable);
    const message = errorMessage(err);
    const finalFailure = permanent || attempt >= config.maxAttempts;

    await db.importJob.update({
      where: { id: job.id },
      data: finalFailure
        ? { status: 'FAILED', error: message, finishedAt: new Date() }
        : { status: 'QUEUED', error: `Tentative ${attempt}/${config.maxAttempts} : ${message}` },
    });
    if (touchedBookId && finalFailure) {
      // Le livre reste en brouillon, visible dans l'admin avec l'import en échec.
      await db.book.updateMany({ where: { id: touchedBookId, status: 'PROCESSING' }, data: { status: 'DRAFT' } });
    }
    log('import en échec', { importJobId: job.id, attempt, permanent, finalFailure, error: message });
    if (!finalFailure) throw err; // laisse pg-boss replanifier avec délai exponentiel
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function AUDIO_MIME(name: string): string {
  try {
    return contentTypeFor(name);
  } catch {
    return 'application/octet-stream';
  }
}

function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 500);
}

async function createBookFor(
  db: Db,
  job: { title: string | null; authorName: string | null; categorySlug: string | null },
  fileName: string,
) {
  const title = job.title ?? basename(fileName, extname(fileName)).replace(/[_]+/g, ' ').trim();
  const authorName = job.authorName ?? 'Auteur inconnu';
  const category = job.categorySlug
    ? await db.category.findUniqueOrThrow({ where: { slug: job.categorySlug } })
    : await db.category.findFirst({ orderBy: { position: 'asc' } });
  if (!category) throw new ImportError('Aucune catégorie : exécutez le seed', true);

  const authorSlug = slugify(authorName);
  const author = await db.author.upsert({ where: { slug: authorSlug }, create: { name: authorName, slug: authorSlug }, update: {} });

  const base = slugify(title);
  let slug = base;
  for (let i = 2; await db.book.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  return db.book.create({
    data: { slug, title, authorId: author.id, categoryId: category.id, status: 'PROCESSING' },
  });
}
