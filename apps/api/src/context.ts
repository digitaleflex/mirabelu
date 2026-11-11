import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { ProviderRegistry } from '@mirabelu/billing';
import type { ApiEnv } from '@mirabelu/config';
import type { Db } from '@mirabelu/database';
import type { ObjectStorage } from '@mirabelu/storage';
import { badRequest } from './errors.js';
import type { OtpSender } from './otp.js';
import type { TokenService } from './tokens.js';

export interface ImportQueue {
  enqueueImport(job: { importJobId: string }): Promise<unknown>;
}

export interface AppDeps {
  env: ApiEnv;
  db: Db;
  storage: ObjectStorage;
  providers: ProviderRegistry;
  otp: OtpSender;
  queue: ImportQueue;
  now?: () => Date;
}

export interface Ctx extends AppDeps {
  tokens: TokenService;
  clock: () => Date;
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; role: 'SUBSCRIBER' | 'ADMIN' };
  }
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'corps'} : ${i.message}`).join(' ; ');
    throw badRequest(msg, 'VALIDATION_ERROR');
  }
  return r.data;
}

export function authOf(req: FastifyRequest): { userId: string; role: 'SUBSCRIBER' | 'ADMIN' } {
  if (!req.auth) throw new Error('route non protégée utilisée comme protégée');
  return req.auth;
}
