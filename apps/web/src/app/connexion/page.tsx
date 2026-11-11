'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, setSession } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { useSession } from '@/lib/session';
import type { UserDto } from '@mirabelu/contracts';

function Login() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { user, ready } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (ready && user) router.replace(next); }, [ready, user, next, router]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/auth/otp/request', { body: { phone } });
      setStep('code'); setCooldown(30);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally { setBusy(false); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api<{ accessToken: string; user: UserDto }>('/auth/otp/verify', { body: { phone, code } });
      setSession(res);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{step === 'phone' ? 'Se connecter' : 'Entrez le code'}</h1>
        <p className="muted">{step === 'phone' ? 'Pas de mot de passe : nous vous envoyons un code par message.' : `Code envoyé au ${phone}.`}</p>
      </div>

      {step === 'phone' ? (
        <form className="form" onSubmit={requestCode}>
          <div className="field">
            <label htmlFor="phone">Numéro de téléphone</label>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01 97 00 00 01" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <span className="muted small">Ajoutez l’indicatif (+225…) si votre numéro n’est pas béninois.</span>
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy || phone.trim().length < 6}>{busy ? 'Envoi…' : 'Recevoir le code'}</button>
        </form>
      ) : (
        <form className="form" onSubmit={verify}>
          <div className="field">
            <label htmlFor="code">Code à 6 chiffres</label>
            <input ref={codeRef} id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy || code.length !== 6}>{busy ? 'Vérification…' : 'Valider'}</button>
          <div className="cluster">
            <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={() => void requestCode()}>
              {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : 'Renvoyer le code'}
            </button>
            <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>Changer de numéro</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><Login /></Suspense>;
}
