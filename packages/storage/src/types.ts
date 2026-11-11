export interface SignedUrl {
  /** Capacité au porteur : ne jamais journaliser, ne jamais persister. */
  url: string;
  /** Epoch secondes. */
  expiresAt: number;
}

export interface StoredObject {
  objectId: string;
  sizeBytes: number;
  sha256: string;
}

export interface UploadFileInput {
  path: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  /** SHA-256 hex calculé localement ; comparé à celui d'AURA après commit. */
  sha256: string;
  /** Clé d'idempotence : un rejeu ne crée pas un second objet. */
  idempotencyKey: string;
}

/** Contrat minimal dont Mirabelu a besoin d'un stockage objet. */
export interface ObjectStorage {
  uploadFile(input: UploadFileInput): Promise<StoredObject>;
  /** URL de lecture inline (audio) — chaque appel compte comme un téléchargement complet côté quota AURA. */
  previewUrl(objectId: string): Promise<SignedUrl>;
  /** URL de téléchargement (originaux, usage admin). */
  downloadUrl(objectId: string): Promise<SignedUrl>;
  /** Supprime (corbeille AURA) un objet ; utilisé pour nettoyer un import échoué. */
  deleteObject(objectId: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
