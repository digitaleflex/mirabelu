import { AuraStorage } from '@mirabelu/storage';
import { createProviders } from '@mirabelu/billing';
import { loadApiEnv } from '@mirabelu/config';
import { createDb, createQueue } from '@mirabelu/database';
import { buildApp } from './app.js';
import { syncAdmins } from './admins.js';
import { ConsoleOtpSender, WebhookOtpSender, type OtpSender } from './otp.js';

const env = loadApiEnv(process.env);
const db = createDb(env.DATABASE_URL);
const queue = await createQueue(env.DATABASE_URL);

const storage = new AuraStorage({
  apiUrl: env.AURA_API_URL,
  token: env.AURA_API_TOKEN,
  ...(env.AURA_BUCKET ? { bucket: env.AURA_BUCKET } : {}),
});

const app = await buildApp({
  env,
  db,
  storage,
  providers: createProviders(env),
  otp:
    env.OTP_DELIVERY === 'webhook'
      ? new WebhookOtpSender(env.OTP_WEBHOOK_URL as string, env.OTP_WEBHOOK_TOKEN)
      : (new ConsoleOtpSender((m) => console.warn(m)) as OtpSender),
  queue,
});

const demoted = await syncAdmins(db, env);
if (demoted > 0) app.log.warn({ demoted }, 'administrateurs retirés de ADMIN_PHONES rétrogradés');

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'arrêt');
  await app.close();
  await queue.stop();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
