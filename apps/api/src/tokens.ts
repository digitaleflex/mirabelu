import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessClaims {
  sub: string;
  role: 'SUBSCRIBER' | 'ADMIN';
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly secret: string,
    private readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer('mirabelu')
      .setAudience('mirabelu-web')
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: 'mirabelu',
        audience: 'mirabelu-web',
      });
      const role = payload.role;
      if (!payload.sub || (role !== 'SUBSCRIBER' && role !== 'ADMIN')) return null;
      return { sub: payload.sub, role };
    } catch {
      return null;
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
  }

  /** Empreinte HMAC d'un code OTP, liée au numéro. */
  otpHash(phone: string, code: string): string {
    return createHmac('sha256', this.secret).update(`otp:${phone}:${code}`).digest('hex');
  }

  otpMatches(phone: string, code: string, expectedHash: string): boolean {
    const a = Buffer.from(this.otpHash(phone, code));
    const b = Buffer.from(expectedHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
