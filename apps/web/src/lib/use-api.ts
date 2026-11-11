'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload(): void;
  setData(v: T | null): void;
}

/** Charge une ressource GET ; `path` null = ne rien charger (ex. utilisateur absent). */
export function useApi<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (path === null) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (live) setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Erreur inattendue')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, n]);

  const reload = useCallback(() => setN((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}
