import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, sep, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class ImportError extends Error {
  constructor(
    message: string,
    /** Définitif : inutile de réessayer (fichier invalide, chemin interdit…). */
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

export function contentTypeFor(path: string): string {
  const t = AUDIO_TYPES[extname(path).toLowerCase()];
  if (!t) throw new ImportError(`Extension non prise en charge : ${extname(path) || '(aucune)'}`, true);
  return t;
}

/**
 * Résout un chemin relatif à IMPORT_DIR en fichier réel, en garantissant qu'il reste dans IMPORT_DIR
 * APRÈS résolution des liens symboliques. Défense en profondeur : l'API filtre déjà les chemins.
 */
export async function resolveImportPath(importDir: string, ref: string, maxBytes: number): Promise<{ path: string; sizeBytes: number }> {
  if (ref.includes('\0')) throw new ImportError('Chemin invalide', true);
  let root: string;
  try {
    root = await realpath(importDir);
  } catch {
    throw new ImportError("Le répertoire d'import n'existe pas", false);
  }
  let real: string;
  try {
    real = await realpath(resolve(root, ref));
  } catch {
    throw new ImportError('Fichier introuvable dans le répertoire d’import', true);
  }
  if (real !== root && !real.startsWith(root + sep)) {
    throw new ImportError('Chemin hors du répertoire d’import', true);
  }
  const st = await stat(real);
  if (!st.isFile()) throw new ImportError('Le chemin ne désigne pas un fichier', true);
  if (st.size === 0) throw new ImportError('Fichier vide', true);
  if (st.size > maxBytes) throw new ImportError(`Fichier trop volumineux (${st.size} octets, limite ${maxBytes})`, true);
  contentTypeFor(real);
  return { path: real, sizeBytes: st.size };
}

/** Télécharge une URL (capacité au porteur : jamais journalisée) vers un fichier, en limitant la taille. */
export async function downloadToFile(
  url: string,
  dest: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sizeBytes: number; sha256: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new ImportError(`Téléchargement impossible : ${(e as Error).message}`, false);
  }
  if (!res.ok || !res.body) {
    throw new ImportError(`Téléchargement refusé (HTTP ${res.status})`, res.status >= 400 && res.status < 500 && res.status !== 429);
  }
  const hash = createHash('sha256');
  let total = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    total += chunk.length;
    hash.update(chunk);
    if (total > maxBytes) body.destroy(new ImportError('Fichier trop volumineux', true));
  });
  await pipeline(body, createWriteStream(dest));
  return { sizeBytes: total, sha256: hash.digest('hex') };
}
