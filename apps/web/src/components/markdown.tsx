import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={i++}>{m[1]}</strong> : <em key={i++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Rendu Markdown minimal et sûr (aucun HTML brut) : titres, listes, gras, italique, paragraphes. */
export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const first = lines[0] ?? '';
        const h = /^(#{1,3})\s+(.*)$/.exec(first);
        if (h && lines.length === 1) return h[1]?.length === 1 ? <h2 key={bi}>{inline(h[2] ?? '')}</h2> : <h3 key={bi}>{inline(h[2] ?? '')}</h3>;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return <ul key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return <ol key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol>;
        }
        return <p key={bi}>{inline(lines.join(' '))}</p>;
      })}
    </div>
  );
}
