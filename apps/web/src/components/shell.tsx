'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlayer } from '@/lib/player';
import { useSession } from '@/lib/session';
import { HomeIcon, SearchIcon, ShelfIcon, UserIcon, HeartIcon } from './icons';
import { PlayerUI } from './player-ui';

const MAIN = [
  { href: '/', label: 'Accueil', Icon: HomeIcon },
  { href: '/explorer', label: 'Explorer', Icon: SearchIcon },
  { href: '/explorer', label: 'Catégories', Icon: SearchIcon, query: 'focus=categories' },
  { href: '/bibliotheque', label: 'Ma bibliothèque', Icon: ShelfIcon },
  { href: '/bibliotheque?tab=historique', label: 'Historique', Icon: ShelfIcon },
  { href: '/bibliotheque?tab=favoris', label: 'Favoris', Icon: HeartIcon },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { track } = usePlayer();
  const { user } = useSession();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isCurrent = (href: string) => {
    const base = href.split('?')[0] ?? href;
    return base === '/' ? path === '/' : path.startsWith(base);
  };

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/explorer?q=${encodeURIComponent(term)}` : '/explorer');
  }

  return (
    <div className={`shell${track ? ' has-mini' : ''}`}>
      {!online && <div className="offline-banner" role="status">Vous êtes hors ligne. Certaines fonctionnalités sont indisponibles.</div>}
      <aside className="sidebar" aria-label="Navigation principale">
        <Link href="/" className="brand-side">Mirabel<i>u</i><span className="brand-sub">Bibliothèque audio</span></Link>
        <nav className="side-nav">
          {MAIN.map(({ href, label, Icon }, i) => (
            <Link key={`${href}-${i}`} href={href} className="side-link" aria-current={isCurrent(href) ? 'page' : undefined}>
              <Icon /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-playlists">
          <p className="muted small" style={{ padding: '8px 12px' }}>Playlists</p>
          <p className="muted small" style={{ padding: '0 12px' }}>Aucune playlist pour le moment.</p>
        </div>
        <div className="side-premium">
          <p style={{ fontWeight: 700 }}>Premium</p>
          <p className="small muted">Écoute illimitée, résumés Comprendre & Appliquer.</p>
          <Link className="btn primary small" href="/abonnement" style={{ marginTop: 8 }}>Découvrir</Link>
        </div>
        <div className="side-account">
          {user ? (
            <Link href="/compte" className="side-link">
              <UserIcon /><span>{user.name || user.phone || 'Mon compte'}</span>
            </Link>
          ) : (
            <Link href="/connexion" className="side-link"><UserIcon /><span>Se connecter</span></Link>
          )}
        </div>
      </aside>

      <header className="app-header">
        <form onSubmit={submitSearch} className="search-form" role="search">
          <SearchIcon />
          <input ref={searchRef} type="search" placeholder="Rechercher un livre, un auteur…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche globale" />
          <kbd className="kbd">Ctrl K</kbd>
        </form>
      </header>

      <main id="contenu">{children}</main>
      <PlayerUI />
      <footer className="site-footer">
        <Link href="/conditions">Conditions</Link> · <Link href="/confidentialite">Confidentialité</Link> · <Link href="/mentions-legales">Mentions légales</Link>
      </footer>
      <nav className="tabbar" aria-label="Navigation principale">
        {MAIN.slice(0, 4).map(({ href, label, Icon }, i) => (
          <Link key={`${href}-${i}`} href={href} aria-current={isCurrent(href) ? 'page' : undefined}>
            <Icon /><span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
