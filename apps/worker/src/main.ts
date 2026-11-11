import { mkdir } from 'node:fs/promises';
import { loadWorkerEnv } from '@mirabelu/config';
import { createDb, createQueue } from '@mirabelu/database';
import { AuraStorage } from '@mirabelu/storage';
import { DEFAULT_LIMITS, processImport, type PipelineDeps } from './pipeline.js';

const env = loadWorkerEnv(process.env);
const db = createDb(env.DATABASE_URL);
const queue = await createQueue(env.DATABASE_URL);
await mkdir(env.WORK_DIR, { recursive: true });

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...extra }));

const deps: PipelineDeps = {
  db,
  storage: new AuraStorage({
    apiUrl: env.AURA_API_URL,
    token: env.AURA_API_TOKEN,
    ...(env.AURA_BUCKET ? { bucket: env.AURA_BUCKET } : {}),
  }),
  log,
  config: {
    importDir: env.IMPORT_DIR,
    workDir: env.WORK_DIR,
    streamBitrateKbps: env.STREAM_BITRATE_KBPS,
    maxSourceBytes: env.MAX_SOURCE_BYTES,
    tools: { ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH },
    ...DEFAULT_LIMITS,
  },
};

await queue.workImport(env.WORKER_CONCURRENCY, (job) => processImport(deps, job.importJobId));
log('worker démarré', { concurrency: env.WORKER_CONCURRENCY });

const shutdown = async (signal: string): Promise<void> => {
  log('arrêt', { signal });
  await queue.stop();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
