import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuraStorage, StorageError } from '../src/index.js';
import { FakeAura } from '../src/testing.js';

let dir: string;
let file: string;
let sha: string;
const content = Buffer.alloc(200_000, 7);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aura-'));
  file = join(dir, 'a.m4a');
  writeFileSync(file, content);
  sha = createHash('sha256').update(content).digest('hex');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const input = () => ({
  path: file,
  displayName: 'a.m4a',
  contentType: 'audio/mp4',
  sizeBytes: content.length,
  sha256: sha,
  idempotencyKey: 'k1',
});

describe('AuraStorage', () => {
  it('envoie un fichier : intent → PUT signé → commit, puis preview', async () => {
    const fake = new FakeAura();
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token });
      const out = await s.uploadFile(input());
      expect(out.sha256).toBe(sha);
      expect(out.sizeBytes).toBe(content.length);
      const p = await s.previewUrl(out.objectId);
      expect(p.url).toContain('/s3/');
      expect(p.expiresAt).toBeGreaterThan(Date.now() / 1000);
    } finally {
      await fake.stop();
    }
  });

  it('suit un commit 202 jusqu’à disponibilité', async () => {
    const fake = new FakeAura({ slowCommit: true });
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token, verifyPollMs: 10 });
      const out = await s.uploadFile(input());
      expect(out.sha256).toBe(sha);
      expect(fake.requests.filter((r) => r.startsWith('GET')).length).toBeGreaterThanOrEqual(2);
    } finally {
      await fake.stop();
    }
  });

  it('mauvais jeton → erreur 401 non réessayable', async () => {
    const fake = new FakeAura();
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: 'wrong' });
      const err = await s.uploadFile(input()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).status).toBe(401);
      expect((err as StorageError).retryable).toBe(false);
    } finally {
      await fake.stop();
    }
  });

  it('503 AURA → erreur réessayable', async () => {
    const fake = new FakeAura({ failIntents: 1 });
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token });
      const err = (await s.uploadFile(input()).catch((e: unknown) => e)) as StorageError;
      expect(err.retryable).toBe(true);
    } finally {
      await fake.stop();
    }
  });

  it('refuse clairement le multipart non géré', async () => {
    const fake = new FakeAura({ multipart: true });
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token });
      await expect(s.uploadFile(input())).rejects.toThrow(/multipart/);
    } finally {
      await fake.stop();
    }
  });

  it('détecte une empreinte différente', async () => {
    const fake = new FakeAura();
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token });
      await expect(s.uploadFile({ ...input(), sha256: 'f'.repeat(64) })).rejects.toThrow(/SHA-256/);
    } finally {
      await fake.stop();
    }
  });

  it('refuse une taille incohérente avant tout appel et ne divulgue aucune URL', async () => {
    const fake = new FakeAura();
    await fake.start();
    try {
      const s = new AuraStorage({ apiUrl: fake.url, token: fake.token });
      // taille déclarée incohérente → refus avant tout appel réseau
      const err = (await s.uploadFile({ ...input(), sizeBytes: content.length + 10 }).catch((e: unknown) => e)) as Error;
      expect(err.message).toMatch(/Taille déclarée/);
      expect(fake.requests).toHaveLength(0);
      expect(err.message).not.toMatch(/X-Amz-Signature/);
      expect(err.message).not.toContain('/s3/');
    } finally {
      await fake.stop();
    }
  });
});
