import { loadApiEnv } from '@mirabelu/config';
import { createDb } from './client.js';
import { seedCatalogBase } from './seed-data.js';

const env = loadApiEnv(process.env);
const db = createDb(env.DATABASE_URL);
try {
  await seedCatalogBase(db);
  for (const phone of env.ADMIN_PHONES) {
    await db.user.upsert({
      where: { phone },
      create: { phone, role: 'ADMIN' },
      update: { role: 'ADMIN' },
    });
  }
  console.log('seed ok');
} finally {
  await db.$disconnect();
}
