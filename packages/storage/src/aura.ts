import { StorageError, type ObjectStorage, type SignedUrl, type StoredObject, type UploadFileInput } from './types.js';
import { putFile } from './http.js';
import { stat } from 'node:fs/promises';

export interface AuraOptions {
  apiUrl: string;
  token: string;
  bucket?: string;
  /** Délai max d'un PUT (fichiers jusqu'à 5 GiB). */
  putTimeoutMs?: number;
  /** Délai max d'attente d'une vérification asynchrone (commit 202). */
  verifyTimeoutMs?: number;
  verifyPollMs?: number;
  fetchImpl?: typeof fetch;
}

interface UploadIntentResponse {
  id: string;
  upload_mode?: string;
  upload_url: string | null;
  headers: Record<string, string>;
}

interface CommitResponse {
  id: string;
  status: string;
  size_bytes?: number;
  checksum_sha256?: string;
}

/**
 * Adaptateur AURA Storage.
 * - Authentification : Bearer aura_<id>_<secret>.
 * - Écriture : upload-intent → PUT présigné (en-têtes exacts) → commit (200 | 202 puis sondage).
 * - Lecture : preview-intent (audio inline). Les URL sont des capacités au porteur : jamais journalisées.
 */
export class AuraStorage implements ObjectStorage {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly putTimeoutMs: number;
  private readonly verifyTimeoutMs: number;
  private readonly verifyPollMs: number;

  constructor(private readonly opts: AuraOptions) {
    this.base = opts.apiUrl.replace(/\/+$/, '');
    this.f = opts.fetchImpl ?? fetch;
    this.putTimeoutMs = opts.putTimeoutMs ?? 2 * 60 * 60 * 1000;
    this.verifyTimeoutMs = opts.verifyTimeoutMs ?? 30 * 60 * 1000;
    this.verifyPollMs = opts.verifyPollMs ?? 2000;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new StorageError(`AURA injoignable : ${(e as Error).message}`, undefined, true);
    }
    if (!res.ok && res.status !== 202) {
      let detail = '';
      try {
        const j = (await res.json()) as { detail?: unknown };
        if (typeof j.detail === 'string') detail = j.detail;
      } catch {
        /* corps non JSON */
      }
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new StorageError(`AURA ${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')} → ${res.status} ${detail}`.trim(), res.status, retryable);
    }
    const data = (res.status === 204 ? {} : await res.json()) as T;
    return { status: res.status, data };
  }

  async uploadFile(input: UploadFileInput): Promise<StoredObject> {
    const st = await stat(input.path);
    if (st.size !== input.sizeBytes) {
      throw new StorageError(`Taille déclarée (${input.sizeBytes}) différente du fichier (${st.size})`);
    }
    const { data: intent } = await this.call<UploadIntentResponse>(
      'POST',
      '/api/v1/objects/upload-intents',
      {
        ...(this.opts.bucket ? { bucket: this.opts.bucket } : {}),
        display_name: input.displayName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
      },
      { 'Idempotency-Key': input.idempotencyKey },
    );

    if (intent.upload_mode === 'multipart' || !intent.upload_url) {
      throw new StorageError(
        'AURA exige un envoi multipart pour cette taille (non géré) : réduire le fichier ou activer un plafond mono-PUT suffisant',
        undefined,
        false,
      );
    }

    await putFile(intent.upload_url, intent.headers, input.path, input.sizeBytes, this.putTimeoutMs);

    const commit = await this.call<CommitResponse>(
      'POST',
      `/api/v1/objects/${intent.id}/commit`,
      undefined,
      { 'Idempotency-Key': input.idempotencyKey },
    );
    let result = commit.data;
    if (commit.status === 202 || result.status === 'verifying') {
      result = await this.waitAvailable(intent.id);
    }
    if (result.status !== 'available') {
      throw new StorageError(`AURA : objet non disponible (statut ${result.status})`);
    }
    const sha = result.checksum_sha256;
    if (sha && sha.toLowerCase() !== input.sha256.toLowerCase()) {
      throw new StorageError("AURA : l'empreinte SHA-256 de l'objet ne correspond pas au fichier envoyé");
    }
    return {
      objectId: intent.id,
      sizeBytes: result.size_bytes ?? input.sizeBytes,
      sha256: (sha ?? input.sha256).toLowerCase(),
    };
  }

  private async waitAvailable(objectId: string): Promise<CommitResponse> {
    const deadline = Date.now() + this.verifyTimeoutMs;
    for (;;) {
      const { data } = await this.call<CommitResponse>('GET', `/api/v1/objects/${objectId}`);
      if (data.status === 'available') return data;
      if (data.status === 'failed' || data.status === 'suspect') {
        throw new StorageError(`AURA : vérification en échec (statut ${data.status})`);
      }
      if (Date.now() > deadline) {
        throw new StorageError('AURA : vérification trop longue', undefined, true);
      }
      await new Promise((r) => setTimeout(r, this.verifyPollMs));
    }
  }

  async previewUrl(objectId: string): Promise<SignedUrl> {
    const { data } = await this.call<{ preview_url: string; expires_at: number }>(
      'POST',
      `/api/v1/objects/${encodeURIComponent(objectId)}/preview-intent`,
    );
    return { url: data.preview_url, expiresAt: data.expires_at };
  }

  async downloadUrl(objectId: string): Promise<SignedUrl> {
    const { data } = await this.call<{ download_url: string; expires_at: number }>(
      'POST',
      `/api/v1/objects/${encodeURIComponent(objectId)}/download-intent`,
    );
    return { url: data.download_url, expiresAt: data.expires_at };
  }

  async deleteObject(objectId: string): Promise<void> {
    await this.call('DELETE', `/api/v1/objects/${encodeURIComponent(objectId)}`);
  }
}
