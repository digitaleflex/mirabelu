import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createQueue, seedCatalogBase, DEFAULT_CATEGORIES, type Db } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/testing.js';

let tdb: TestDatabase;
let db: Db;

beforeAll(async () => {
  tdb = await createTestDatabase();
  db = createDb(tdb.url);
});

afterAll(async () => {
  await db.$disconnect();
  await tdb.drop();
});

describe('schéma', () => {
  it('seed des catégories est idempotent', async () => {
    await seedCatalogBase(db);
    await seedCatalogBase(db);
    expect(await db.category.count()).toBe(DEFAULT_CATEGORIES.length);
  });

  it('un livre avec actifs, chapitres et essentiels', async () => {
    const cat = await db.category.findFirstOrThrow();
    const author = await db.author.create({ data: { name: 'Auteur', slug: 'auteur' } });
    const book = await db.book.create({
      data: {
        slug: 'livre-1',
        title: 'Livre 1',
        authorId: author.id,
        categoryId: cat.id,
        territories: ['BJ', 'CI'],
        assets: {
          create: [
            { kind: 'STREAM', auraObjectId: 'o1', sha256: 'a'.repeat(64), sizeBytes: 123n, durationSec: 60, mimeType: 'audio/mp4' },
          ],
        },
        chapters: { create: [{ position: 1, title: 'Intro', startSec: 0, endSec: 60 }] },
        essentials: { create: { understandMd: 'x', applyMd: 'y' } },
      },
      include: { assets: true, chapters: true, essentials: true },
    });
    expect(book.assets[0]?.sizeBytes).toBe(123n);
    expect(book.territories).toEqual(['BJ', 'CI']);
  });

  it('refuse deux paiements avec la même référence fournisseur', async () => {
    const user = await db.user.create({ data: { phone: '+22900000001' } });
    const base = { userId: user.id, plan: 'QUARTERLY', amountXof: 7500, provider: 'FEDAPAY', providerRef: 'tx1' } as const;
    await db.payment.create({ data: base });
    await expect(db.payment.create({ data: base })).rejects.toThrow();
  });

  it('refuse deux actifs STREAM identiques (dédoublonnage par sha256)', async () => {
    const cat = await db.category.findFirstOrThrow();
    const author = await db.author.findFirstOrThrow();
    const b = await db.book.create({ data: { slug: 'livre-2', title: 'L2', authorId: author.id, categoryId: cat.id } });
    await expect(
      db.audioAsset.create({
        data: { bookId: b.id, kind: 'STREAM', auraObjectId: 'o2', sha256: 'a'.repeat(64), sizeBytes: 1n, durationSec: 1, mimeType: 'audio/mp4' },
      }),
    ).rejects.toThrow();
  });
});

describe('file de tâches', () => {
  it('livre un job d’import au worker, une seule fois (l’idempotence métier est dans le handler)', async () => {
    const queue = await createQueue(tdb.url);
    try {
      const received: string[] = [];
      await queue.workImport(1, async (j) => {
        received.push(j.importJobId);
      });
      await queue.enqueueImport({ importJobId: 'job-1' });
      await vi_waitFor(() => received.length >= 1);
      await new Promise((r) => setTimeout(r, 2500));
      expect(received).toEqual(['job-1']);
    } finally {
      await queue.stop();
    }
  }, 30_000);
});

async function vi_waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
}
