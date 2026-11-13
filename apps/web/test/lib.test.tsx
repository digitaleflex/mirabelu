import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/components/markdown';
import { fmtClock, fmtDuration, fmtXof } from '../src/lib/api';
import { safeNext } from '../src/lib/safe-next';

describe('safeNext', () => {
  it('accepte les chemins internes', () => {
    expect(safeNext('/bibliotheque')).toBe('/bibliotheque');
    expect(safeNext('/livre/abc?x=1')).toBe('/livre/abc?x=1');
  });
  it('refuse les redirections ouvertes', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNext(bad as string | null | undefined)).toBe('/');
    }
  });
});

describe('formats', () => {
  it('durées et horloge', () => {
    expect(fmtDuration(59 * 60)).toBe('59 min');
    expect(fmtDuration(3600 + 5 * 60)).toBe('1 h 05');
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtClock(-3)).toBe('0:00');
  });
  it('montants en FCFA', () => {
    expect(fmtXof(7500)).toContain('FCFA');
    expect(fmtXof(7500)).toMatch(/7\D?500/);
  });
});

describe('Markdown', () => {
  it('rend titres, listes et emphase', () => {
    const html = renderToStaticMarkup(<Markdown source={'# Titre\n\n## Sous-titre\n\n- un\n- **deux**\n\n1. a\n2. b\n\nTexte *fort*'} />);
    expect(html).toContain('<h2>Titre</h2>');
    expect(html).toContain('<h3>Sous-titre</h3>');
    expect(html).toContain('<ul><li>un</li><li><strong>deux</strong></li></ul>');
    expect(html).toContain('<ol><li>a</li><li>b</li></ol>');
    expect(html).toContain('<em>fort</em>');
  });
  it('n’interprète jamais de HTML brut', () => {
    const html = renderToStaticMarkup(<Markdown source={'<script>alert(1)</script> et <img src=x onerror=alert(1)>'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
