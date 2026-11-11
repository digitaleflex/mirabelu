import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { StorageError } from './types.js';

/**
 * PUT d'un fichier en flux vers une URL présignée, avec EXACTEMENT les en-têtes
 * signés fournis par AURA (SSE, Content-Length…). L'URL n'apparaît jamais dans
 * les erreurs : c'est une capacité au porteur.
 */
export function putFile(
  url: string,
  headers: Record<string, string>,
  path: string,
  sizeBytes: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const finalHeaders: Record<string, string> = { ...headers };
    const hasLength = Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-length');
    if (!hasLength) finalHeaders['Content-Length'] = String(sizeBytes);

    const req = lib.request(
      u,
      { method: 'PUT', headers: finalHeaders, timeout: timeoutMs },
      (res) => {
        res.resume();
        res.on('end', () => {
          const s = res.statusCode ?? 0;
          if (s >= 200 && s < 300) resolve();
          else reject(new StorageError(`PUT objet refusé (HTTP ${s})`, s, s >= 500 || s === 408 || s === 429));
        });
      },
    );
    req.on('timeout', () => req.destroy(new StorageError('PUT objet : délai dépassé', undefined, true)));
    req.on('error', (e) =>
      reject(e instanceof StorageError ? e : new StorageError(`PUT objet : ${(e as Error).message}`, undefined, true)),
    );
    const src = createReadStream(path);
    src.on('error', (e) => req.destroy(e));
    src.pipe(req);
  });
}
