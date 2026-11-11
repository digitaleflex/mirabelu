import type { UserDto } from '@mirabelu/contracts';

const BASE = '/api';

let accessToken: string | null = null;
let inflightRefresh: Promise<UserDto | null> | null = null;
const listeners = new Set<(u: UserDto | null) => void>();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function onSessionChange(fn: (u: UserDto | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (u: UserDto | null) => listeners.forEach((l) => l(u));

interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

/** Échange le cookie de session contre un jeton d'accès. Une seule requête en vol à la fois. */
export function refreshSession(): Promise<UserDto | null> {
  inflightRefresh ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        accessToken = null;
        emit(null);
        return null;
      }
      const body = (await res.json()) as AuthResponse;
      accessToken = body.accessToken;
      emit(body.user);
      return body.user;
    } catch {
      return null; // réseau coupé : on garde l'état courant
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export function setSession(body: AuthResponse): void {
  accessToken = body.accessToken;
  emit(body.user);
}

/** Met à jour l'utilisateur affiché sans toucher au jeton d'accès. */
export function updateUser(user: UserDto): void {
  emit(user);
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  accessToken = null;
  emit(null);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      keepalive: init.keepalive,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez votre réseau.');
  }

  if (res.status === 401 && retry) {
    const user = await refreshSession();
    if (user) return api<T>(path, init, false);
  }
  if (!res.ok) {
    let code = 'ERROR';
    let message = 'Une erreur est survenue.';
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* corps vide */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const fmtDuration = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

export const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export const fmtXof = (n: number): string => `${n.toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;
