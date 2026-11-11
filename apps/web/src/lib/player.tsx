'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BookSummaryDto, ChapterDto, PlaybackResponse } from '@mirabelu/contracts';
import { api, ApiError } from './api';

export interface Track {
  book: BookSummaryDto;
  chapters: ChapterDto[];
}

interface PlayerState {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  position: number;
  duration: number;
  rate: number;
  sleepMinutes: number | null;
  expanded: boolean;
  play(track: Track): Promise<void>;
  toggle(): void;
  seek(sec: number): void;
  skip(delta: number): void;
  setRate(r: number): void;
  setSleep(minutes: number | null): void;
  setExpanded(v: boolean): void;
  close(): void;
}

const Ctx = createContext<PlayerState | null>(null);
export const usePlayer = (): PlayerState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('PlayerProvider manquant');
  return v;
};

/** On redemande une URL quand il reste moins de 90 s de validité. */
const RENEW_MARGIN_MS = 90_000;
const SAVE_EVERY_MS = 15_000;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const urlExpiresAt = useRef(0);
  const listenedSinceSave = useRef(0);
  const lastTick = useRef(0);
  const lastSave = useRef(0);
  const sleepAt = useRef<number | null>(null);
  const trackRef = useRef<Track | null>(null);
  const renewing = useRef<Promise<void> | null>(null);
  const errorRenewals = useRef<number[]>([]);

  const bookId = track?.book.id;

  const save = useCallback((completed?: boolean) => {
    const a = audioRef.current;
    const t = trackRef.current;
    if (!a || !t) return;
    const listened = Math.min(3600, Math.round(listenedSinceSave.current));
    listenedSinceSave.current = 0;
    lastSave.current = Date.now();
    void api(`/library/progress/${t.book.id}`, {
      method: 'PUT',
      body: { positionSec: Math.floor(a.currentTime), ...(listened > 0 ? { listenedSec: listened } : {}), ...(completed !== undefined ? { completed } : {}) },
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  /** Obtient une URL fraîche (le serveur la met en cache) et la branche en gardant la position. */
  const renew = useCallback(async (resume: boolean): Promise<void> => {
    const a = audioRef.current;
    const t = trackRef.current;
    if (!a || !t) return;
    if (renewing.current) return renewing.current;
    renewing.current = (async () => {
      const at = a.currentTime;
      const wasPlaying = !a.paused;
      const pb = await api<PlaybackResponse>(`/playback/${t.book.id}/url`, { method: 'POST' });
      urlExpiresAt.current = new Date(pb.expiresAt).getTime();
      a.src = pb.url;
      a.load();
      a.currentTime = at;
      if (resume || wasPlaying) await a.play().catch(() => undefined);
    })().finally(() => {
      renewing.current = null;
    });
    return renewing.current;
  }, []);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    audioRef.current = a;

    const onTime = () => {
      const now = Date.now();
      if (!a.paused) {
        listenedSinceSave.current += Math.min(2, (now - lastTick.current) / 1000) * a.playbackRate;
        if (now - lastSave.current > SAVE_EVERY_MS) save();
        if (sleepAt.current && now >= sleepAt.current) {
          a.pause();
          sleepAt.current = null;
          setSleepMinutes(null);
        }
      }
      lastTick.current = now;
      setPosition(a.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => { lastTick.current = Date.now(); setPlaying(true); };
    const onPause = () => { setPlaying(false); save(); };
    const onEnded = () => { setPlaying(false); save(true); };
    const onError = () => {
      // URL expirée (403) ou coupure : on redemande une URL et on reprend là où l'on en était.
      if (!trackRef.current) return;
      // Garde-fou : un format illisible ne doit pas déclencher une boucle de renouvellements.
      const now = Date.now();
      errorRenewals.current = errorRenewals.current.filter((t) => now - t < 60_000);
      if (errorRenewals.current.length >= 3) {
        setError('Ce livre ne peut pas être lu sur cet appareil pour le moment. Vérifiez votre connexion puis réessayez.');
        return;
      }
      errorRenewals.current.push(now);
      renew(true).catch(() => setError('La lecture a été interrompue. Appuyez sur lecture pour réessayer.'));
    };

    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);

    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => save());

    return () => {
      a.pause();
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [renew, save]);

  const play = useCallback(async (next: Track) => {
    const a = audioRef.current;
    if (!a) return;
    if (trackRef.current?.book.id === next.book.id) {
      if (a.paused) await a.play().catch(() => undefined);
      setExpanded(true);
      return;
    }
    if (trackRef.current) save();
    errorRenewals.current = [];
    setError(null);
    setLoading(true);
    trackRef.current = next;
    setTrack(next);
    setPosition(0);
    setExpanded(true);
    try {
      const pb = await api<PlaybackResponse>(`/playback/${next.book.id}/url`, { method: 'POST' });
      urlExpiresAt.current = new Date(pb.expiresAt).getTime();
      setDuration(pb.durationSec);
      a.src = pb.url;
      a.playbackRate = rate;
      await new Promise<void>((resolve) => {
        const done = () => {
          a.removeEventListener('loadedmetadata', done);
          a.removeEventListener('error', done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, 20_000);
        a.addEventListener('loadedmetadata', done);
        a.addEventListener('error', done);
        a.load();
      });
      if (pb.resumeAtSec > 0) a.currentTime = pb.resumeAtSec;
      await a.play().catch(() => undefined);
    } catch (e) {
      trackRef.current = null;
      setTrack(null);
      setError(e instanceof ApiError ? e.message : 'Lecture impossible.');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [rate, save]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !trackRef.current) return;
    if (!a.paused) { a.pause(); return; }
    // Reprise après une pause : si l'URL est (presque) expirée, on la renouvelle d'abord.
    if (Date.now() > urlExpiresAt.current - RENEW_MARGIN_MS) {
      renew(true).catch(() => setError('Impossible de reprendre la lecture. Réessayez.'));
    } else {
      void a.play().catch(() => undefined);
    }
  }, [renew]);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(sec, a.duration || sec));
    setPosition(a.currentTime);
  }, []);
  const skip = useCallback((d: number) => { if (audioRef.current) seek(audioRef.current.currentTime + d); }, [seek]);
  const setRate = useCallback((r: number) => { setRateState(r); if (audioRef.current) audioRef.current.playbackRate = r; }, []);
  const setSleep = useCallback((m: number | null) => { setSleepMinutes(m); sleepAt.current = m ? Date.now() + m * 60_000 : null; }, []);
  const close = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); save(); a.removeAttribute('src'); a.load(); }
    trackRef.current = null;
    setTrack(null);
    setExpanded(false);
  }, [save]);

  // Commandes de l'écran verrouillé et notifications système.
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: track.book.title, artist: track.book.author.name, album: 'Mirabelu' });
    ms.setActionHandler('play', () => toggle());
    ms.setActionHandler('pause', () => toggle());
    ms.setActionHandler('seekbackward', () => skip(-15));
    ms.setActionHandler('seekforward', () => skip(30));
    ms.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
    return () => {
      for (const k of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as const) ms.setActionHandler(k, null);
    };
  }, [track, toggle, skip, seek]);

  const value = useMemo<PlayerState>(() => ({
    track, playing, loading, error, position, duration, rate, sleepMinutes, expanded,
    play, toggle, seek, skip, setRate, setSleep, setExpanded, close,
  }), [track, playing, loading, error, position, duration, rate, sleepMinutes, expanded, play, toggle, seek, skip, setRate, setSleep, close]);

  void bookId;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
