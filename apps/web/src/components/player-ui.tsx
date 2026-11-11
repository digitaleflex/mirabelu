'use client';

import { useEffect } from 'react';
import { usePlayer } from '@/lib/player';
import { fmtClock } from '@/lib/api';
import { Back15Icon, ChevronDownIcon, Fwd30Icon, PauseIcon, PlayIcon } from './icons';
import { Cover } from './cover';

const RATES = [0.8, 1, 1.25, 1.5, 2];
const SLEEPS = [15, 30, 60];

/** La mirabelle se remplit d'or au fil de l'écoute. */
function Fruit({ progress }: { progress: number }) {
  const p = Math.min(1, Math.max(0, progress));
  // L'ellipse va de y=46 (haut) à y=254 (bas) : 0 % = vide, 100 % = pleine.
  const top = 254 - 208 * p;
  return (
    <svg className="fruit" viewBox="0 0 240 260" aria-hidden="true">
      <defs>
        <clipPath id="fruit-clip"><ellipse cx="120" cy="150" rx="98" ry="104" /></clipPath>
      </defs>
      <path className="stem" d="M120 46 C120 30 126 20 136 14" />
      <path className="leaf" d="M136 16 C150 4 170 8 176 20 C162 30 144 28 136 16z" />
      <ellipse className="rest" cx="120" cy="150" rx="98" ry="104" />
      <g clipPath="url(#fruit-clip)">
        <rect className="fill" x="0" y={top} width="240" height="260" />
      </g>
      <path className="bloom" d="M70 100 C80 70 120 56 150 66 C120 70 90 86 80 118 C74 118 70 110 70 100z" />
      <path d="M120 54 C116 110 116 190 120 254" stroke="rgba(31,22,51,0.22)" strokeWidth="3" fill="none" />
    </svg>
  );
}

export function PlayerUI() {
  const p = usePlayer();
  const { track } = p;

  useEffect(() => {
    if (!p.expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [p.expanded, p]);

  if (!track) return null;
  const progress = p.duration > 0 ? p.position / p.duration : 0;
  const chapter = [...track.chapters].reverse().find((c) => p.position >= c.startSec);

  return (
    <>
      {!p.expanded && (
        <div className="mini" role="region" aria-label="Lecteur">
          <div className="progress-line" aria-hidden="true"><i style={{ width: `${progress * 100}%`, background: 'var(--mirabelle)' }} /></div>
          <Cover title={track.book.title} url={track.book.coverUrl} small />
          <button className="t" onClick={() => p.setExpanded(true)} aria-label={`Ouvrir le lecteur : ${track.book.title}`}>
            <strong>{track.book.title}</strong>
            <span>{track.book.author.name}</span>
          </button>
          <button className="icon-btn" onClick={() => p.skip(-15)} aria-label="Reculer de 15 secondes"><Back15Icon /></button>
          <button className="icon-btn gold" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Lecture'}>{p.playing ? <PauseIcon /> : <PlayIcon />}</button>
        </div>
      )}

      {p.expanded && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={`Lecture de ${track.book.title}`}>
          <header>
            <button className="icon-btn" onClick={() => p.setExpanded(false)} aria-label="Réduire le lecteur" style={{ color: 'inherit' }}><ChevronDownIcon /></button>
            <button className="link" onClick={p.close}>Arrêter</button>
          </header>

          <div className="stage">
            <Fruit progress={progress} />
            <div>
              <h2>{track.book.title}</h2>
              <p style={{ opacity: 0.8 }}>{track.book.author.name}</p>
              {chapter && <p className="small" style={{ opacity: 0.7, marginTop: 6 }}>{chapter.title}</p>}
            </div>
            {p.loading && <p role="status">Chargement…</p>}
            {p.error && <div className="notice error" role="alert">{p.error}</div>}
          </div>

          <div>
            <div className="scrub">
              <label className="sr-only" htmlFor="scrub">Position dans le livre</label>
              <input
                id="scrub" type="range" min={0} max={Math.max(1, Math.floor(p.duration))} step={1} value={Math.floor(p.position)}
                onChange={(e) => p.seek(Number(e.target.value))}
                aria-valuetext={`${fmtClock(p.position)} sur ${fmtClock(p.duration)}`}
              />
              <div className="times"><span>{fmtClock(p.position)}</span><span>-{fmtClock(Math.max(0, p.duration - p.position))}</span></div>
            </div>

            <div className="controls">
              <button className="icon-btn" onClick={() => p.skip(-15)} aria-label="Reculer de 15 secondes"><Back15Icon /></button>
              <button className="icon-btn gold" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Lecture'}>{p.playing ? <PauseIcon /> : <PlayIcon />}</button>
              <button className="icon-btn" onClick={() => p.skip(30)} aria-label="Avancer de 30 secondes"><Fwd30Icon /></button>
            </div>

            <div className="extras" role="group" aria-label="Vitesse de lecture">
              {RATES.map((r) => (
                <button key={r} aria-pressed={p.rate === r} onClick={() => p.setRate(r)}>{r}×</button>
              ))}
            </div>
            <div className="extras" role="group" aria-label="Minuterie de sommeil" style={{ marginTop: 10 }}>
              {SLEEPS.map((m) => (
                <button key={m} aria-pressed={p.sleepMinutes === m} onClick={() => p.setSleep(p.sleepMinutes === m ? null : m)}>
                  Arrêt dans {m} min
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
