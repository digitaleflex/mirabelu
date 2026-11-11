import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ObjectStorage, SignedUrl, StoredObject, UploadFileInput } from './types.js';

/** Stockage en mémoire pour les tests d'API : compte les intents comme le fait le quota AURA. */
export class InMemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { sha256: string; sizeBytes: number; path: string }>();
  previewCalls = 0;
  downloadCalls = 0;
  private urlSeq = 0;
  /** Durée de vie des URL émises, en secondes. */
  ttl = 900;

  async uploadFile(input: UploadFileInput): Promise<StoredObject> {
    const existing = [...this.objects.entries()].find(([, o]) => o.path === input.idempotencyKey);
    if (existing) return { objectId: existing[0], sizeBytes: existing[1].sizeBytes, sha256: existing[1].sha256 };
    const objectId = randomUUID();
    this.objects.set(objectId, { sha256: input.sha256, sizeBytes: input.sizeBytes, path: input.idempotencyKey });
    return { objectId, sizeBytes: input.sizeBytes, sha256: input.sha256 };
  }

  async previewUrl(objectId: string): Promise<SignedUrl> {
    if (!this.objects.has(objectId)) throw new Error('not found');
    this.previewCalls++;
    return {
      url: `https://aura.test/p/${objectId}?sig=${++this.urlSeq}`,
      expiresAt: Math.floor(Date.now() / 1000) + this.ttl,
    };
  }

  async downloadUrl(objectId: string): Promise<SignedUrl> {
    if (!this.objects.has(objectId)) throw new Error('not found');
    this.downloadCalls++;
    return {
      url: `https://aura.test/d/${objectId}?sig=${++this.urlSeq}`,
      expiresAt: Math.floor(Date.now() / 1000) + this.ttl,
    };
  }

  async deleteObject(objectId: string): Promise<void> {
    this.objects.delete(objectId);
  }
}

interface FakeObject {
  id: string;
  size: number;
  contentType: string;
  status: 'pending' | 'verifying' | 'available';
  body?: Buffer;
  sha256?: string;
  verifyPolls: number;
}

export interface FakeAuraOptions {
  token?: string;
  /** Le premier commit répond 202 « verifying » puis disponible après N sondages. */
  slowCommit?: boolean;
  /** Répond multipart au lieu d'une URL de PUT. */
  multipart?: boolean;
  /** Fait échouer la première N requêtes upload-intents en 503. */
  failIntents?: number;
}

/**
 * Faux AURA Storage fidèle au contrat réel : Bearer, intents, PUT avec en-têtes signés
 * exacts (SSE AES256 + Content-Length), commit 200/202, preview-intent.
 */
export class FakeAura {
  readonly objects = new Map<string, FakeObject>();
  readonly requests: string[] = [];
  private server!: http.Server;
  url = '';
  readonly token: string;
  private failIntents: number;

  constructor(private readonly opts: FakeAuraOptions = {}) {
    this.token = opts.token ?? 'aura_test_secret';
    this.failIntents = opts.failIntents ?? 0;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    this.requests.push(`${req.method} ${url.pathname}`);

    // GET présigné (lecture/téléchargement) : pas de Bearer, la signature fait foi.
    if (req.method === 'GET' && url.pathname.startsWith('/s3/')) {
      const obj = this.objects.get(url.pathname.slice(4));
      if (!obj?.body) return this.json(res, 404, { detail: 'not found' });
      res.writeHead(200, { 'content-type': obj.contentType, 'content-length': obj.body.length });
      res.end(obj.body);
      return;
    }

    // PUT présigné : pas de Bearer, mais les en-têtes signés sont obligatoires.
    if (req.method === 'PUT' && url.pathname.startsWith('/s3/')) {
      const id = url.pathname.slice(4);
      const obj = this.objects.get(id);
      const body = await this.readBody(req);
      if (!obj || req.headers['x-amz-server-side-encryption'] !== 'AES256') {
        return this.json(res, 403, { detail: 'signature mismatch' });
      }
      if (Number(req.headers['content-length']) !== obj.size || body.length !== obj.size) {
        return this.json(res, 403, { detail: 'content-length mismatch' });
      }
      obj.body = body;
      res.writeHead(200).end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      return this.json(res, 401, { detail: 'unauthorized' });
    }

    const path = url.pathname;
    if (req.method === 'POST' && path === '/api/v1/objects/upload-intents') {
      if (this.failIntents > 0) {
        this.failIntents--;
        return this.json(res, 503, { detail: 'busy' });
      }
      const b = JSON.parse((await this.readBody(req)).toString()) as {
        size_bytes: number;
        content_type: string;
      };
      const id = randomUUID();
      this.objects.set(id, { id, size: b.size_bytes, contentType: b.content_type, status: 'pending', verifyPolls: 0 });
      if (this.opts.multipart) {
        return this.json(res, 200, { id, upload_mode: 'multipart', upload_url: null, headers: {} });
      }
      return this.json(res, 200, {
        id,
        status: 'pending',
        method: 'PUT',
        upload_url: `${this.url}/s3/${id}?X-Amz-Signature=secret`,
        headers: {
          'Content-Type': b.content_type,
          'x-amz-server-side-encryption': 'AES256',
          'Content-Length': String(b.size_bytes),
        },
      });
    }

    const m = /^\/api\/v1\/objects\/([0-9a-f-]{36})(?:\/(commit|preview-intent|download-intent))?$/.exec(path);
    if (!m) return this.json(res, 404, { detail: 'not found' });
    const obj = this.objects.get(m[1] as string);
    if (!obj) return this.json(res, 404, { detail: 'object not found' });

    if (req.method === 'POST' && m[2] === 'commit') {
      if (!obj.body) return this.json(res, 422, { detail: 'upload not found at storage' });
      obj.sha256 = createHash('sha256').update(obj.body).digest('hex');
      if (this.opts.slowCommit) {
        obj.status = 'verifying';
        return this.json(res, 202, { id: obj.id, status: 'verifying', size_bytes: obj.size });
      }
      obj.status = 'available';
      return this.json(res, 200, { id: obj.id, status: 'available', size_bytes: obj.size, checksum_sha256: obj.sha256 });
    }
    if (req.method === 'GET' && !m[2]) {
      if (obj.status === 'verifying' && ++obj.verifyPolls >= 2) obj.status = 'available';
      return this.json(res, 200, { id: obj.id, status: obj.status, size_bytes: obj.size, checksum_sha256: obj.sha256 });
    }
    if (req.method === 'POST' && (m[2] === 'preview-intent' || m[2] === 'download-intent')) {
      if (obj.status !== 'available') return this.json(res, 409, { detail: 'object not available' });
      const exp = Math.floor(Date.now() / 1000) + 900;
      const u = `${this.url}/s3/${obj.id}?X-Amz-Signature=get`;
      return this.json(res, 200, m[2] === 'preview-intent'
        ? { id: obj.id, preview_url: u, expires_at: exp, expires_in: 900 }
        : { id: obj.id, download_url: u, expires_at: exp, expires_in: 900 });
    }
    if (req.method === 'DELETE' && !m[2]) {
      this.objects.delete(obj.id);
      return this.json(res, 200, { id: obj.id, status: 'trashed' });
    }
    return this.json(res, 405, { detail: 'method not allowed' });
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
