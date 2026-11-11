import { describe, expect, it } from 'vitest';
import { checkoutBody, importCreateBody, progressBody, slug, verifyOtpBody } from '../src/index';

describe('contrats', () => {
  it('valide les slugs', () => {
    expect(slug.safeParse('le-petit-prince').success).toBe(true);
    expect(slug.safeParse('Le Petit Prince').success).toBe(false);
    expect(slug.safeParse('-mauvais').success).toBe(false);
  });

  it('exige un code OTP à 6 chiffres', () => {
    expect(verifyOtpBody.safeParse({ phone: '+22997000000', code: '123456' }).success).toBe(true);
    expect(verifyOtpBody.safeParse({ phone: '+22997000000', code: '12345' }).success).toBe(false);
    expect(verifyOtpBody.safeParse({ phone: '+22997000000', code: 'abcdef' }).success).toBe(false);
  });

  it('refuse un prestataire ou un plan inconnu', () => {
    expect(checkoutBody.safeParse({ plan: 'ANNUAL', provider: 'KKIAPAY' }).success).toBe(true);
    expect(checkoutBody.safeParse({ plan: 'WEEKLY', provider: 'KKIAPAY' }).success).toBe(false);
    expect(checkoutBody.safeParse({ plan: 'ANNUAL', provider: 'PAYPAL' }).success).toBe(false);
  });

  it('borne la progression de lecture', () => {
    expect(progressBody.safeParse({ positionSec: 120, listenedSec: 15 }).success).toBe(true);
    expect(progressBody.safeParse({ positionSec: -1 }).success).toBe(false);
    expect(progressBody.safeParse({ positionSec: 10, listenedSec: 99999 }).success).toBe(false);
  });

  it("valide la création d'un import", () => {
    expect(importCreateBody.safeParse({ sourceType: 'LOCAL_PATH', sourceRef: 'a/b.mp3' }).success).toBe(true);
    expect(importCreateBody.safeParse({ sourceType: 'URL', sourceRef: 'x' }).success).toBe(false);
  });
});
