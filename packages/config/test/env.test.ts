import { describe, expect, it } from 'vitest';
import { loadApiEnv, loadWorkerEnv } from '../src/index';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  AURA_API_URL: 'https://aura.example.com',
  AURA_API_TOKEN: 'aura_abc_secretsecret',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadApiEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = loadApiEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.ADMIN_PHONES).toEqual([]);
    expect(env.PAYMENT_PROVIDERS).toEqual([]);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('refuse un JWT_SECRET trop court', () => {
    expect(() => loadApiEnv({ ...base, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });

  it('interdit mock, OTP console et cookies non sécurisés en production', () => {
    const prod = { ...base, NODE_ENV: 'production', OTP_DELIVERY: 'webhook', OTP_WEBHOOK_URL: 'https://sms.example.com', COOKIE_SECURE: 'true' };
    expect(() => loadApiEnv({ ...prod, PAYMENT_PROVIDERS: 'mock' })).toThrow(/mock/);
    expect(() => loadApiEnv({ ...prod, OTP_DELIVERY: 'console' })).toThrow(/OTP_DELIVERY/);
    expect(() => loadApiEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(loadApiEnv(prod).NODE_ENV).toBe('production');
  });

  it('exige les clés des prestataires activés', () => {
    expect(() => loadApiEnv({ ...base, PAYMENT_PROVIDERS: 'fedapay' })).toThrow(/FEDAPAY/);
    expect(() => loadApiEnv({ ...base, PAYMENT_PROVIDERS: 'kkiapay' })).toThrow(/KKIAPAY/);
    const env = loadApiEnv({
      ...base,
      PAYMENT_PROVIDERS: 'fedapay, kkiapay',
      FEDAPAY_SECRET_KEY: 'sk', FEDAPAY_WEBHOOK_SECRET: 'wh',
      KKIAPAY_PUBLIC_KEY: 'pk', KKIAPAY_PRIVATE_KEY: 'pr', KKIAPAY_SECRET: 'sc',
    });
    expect(env.PAYMENT_PROVIDERS).toEqual(['fedapay', 'kkiapay']);
  });

  it('exige OTP_WEBHOOK_URL avec la livraison par webhook', () => {
    expect(() => loadApiEnv({ ...base, OTP_DELIVERY: 'webhook' })).toThrow(/OTP_WEBHOOK_URL/);
  });
});

describe('loadWorkerEnv', () => {
  it('charge la configuration du worker', () => {
    const env = loadWorkerEnv({ ...base, STREAM_BITRATE_KBPS: '48' });
    expect(env.STREAM_BITRATE_KBPS).toBe(48);
    expect(env.WORKER_CONCURRENCY).toBe(1);
  });
});
