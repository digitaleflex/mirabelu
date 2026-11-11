import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

export const DEFAULT_TEST_ADMIN_URL =
  'postgresql://mirabelu:mirabelu@127.0.0.1:54329/postgres';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * Crée une base jetable, y applique les migrations SQL versionnées (celles qui
 * partent en production) et renvoie son URL. Utilisé par les tests de tous les paquets.
 */
export async function createTestDatabase(
  adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL,
): Promise<TestDatabase> {
  const name = `mb_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    await c.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }
  await c.end();

  return {
    url: url.toString(),
    async drop() {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
