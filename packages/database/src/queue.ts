import PgBoss from 'pg-boss';

export const QUEUES = {
  importBook: 'import-book',
} as const;

export type ImportBookJob = { importJobId: string };

export interface Queue {
  boss: PgBoss;
  enqueueImport(job: ImportBookJob): Promise<string | null>;
  workImport(
    concurrency: number,
    handler: (job: ImportBookJob) => Promise<void>,
  ): Promise<void>;
  stop(): Promise<void>;
}

/**
 * File de tâches sur PostgreSQL (pg-boss) — pas de Redis.
 * Un job d'import = un ImportJob en base ; la file ne porte que son identifiant.
 */
export async function createQueue(databaseUrl: string): Promise<Queue> {
  const boss = new PgBoss(databaseUrl);
  boss.on('error', (err) => {
    console.error('[pg-boss]', err.message);
  });
  await boss.start();
  await boss.createQueue(QUEUES.importBook, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 6 * 3600,
  });

  return {
    boss,
    enqueueImport: (job) =>
      boss.send(QUEUES.importBook, job, { singletonKey: job.importJobId }),
    async workImport(concurrency, handler) {
      for (let i = 0; i < concurrency; i++) {
        await boss.work<ImportBookJob>(
          QUEUES.importBook,
          { pollingIntervalSeconds: 2, batchSize: 1 },
          async (jobs) => {
            for (const job of jobs) await handler(job.data);
          },
        );
      }
    },
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
  };
}
