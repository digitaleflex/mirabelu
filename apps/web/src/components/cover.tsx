const PALETTE = [
  { bg: '#3b2d5c', fg: '#f2b33d' },
  { bg: '#f2b33d', fg: '#1f1633' },
  { bg: '#3e6b45', fg: '#f3f0fa' },
  { bg: '#6b5b95', fg: '#fbe9bd' },
  { bg: '#1f1633', fg: '#f2b33d' },
  { bg: '#b5546b', fg: '#fff3f5' },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Couverture de remplacement : aplat de couleur déterministe et initiale du titre. */
export function Cover({ title, url, small = false }: { title: string; url?: string | null; small?: boolean }) {
  const c = PALETTE[hash(title) % PALETTE.length] as { bg: string; fg: string };
  if (url) {
    return (
      <div className={`cover${small ? ' sm' : ''}`} style={{ background: c.bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" loading="lazy" />
      </div>
    );
  }
  const initial = title.trim().charAt(0).toUpperCase() || 'M';
  return (
    <div className={`cover${small ? ' sm' : ''}`} style={{ background: c.bg, color: c.fg }} aria-hidden="true">
      <span>{initial}</span>
    </div>
  );
}
