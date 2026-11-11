'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { usePlayer } from '@/lib/player';
import { HomeIcon, SearchIcon, ShelfIcon, UserIcon } from './icons';
import { PlayerUI } from './player-ui';

const TABS = [
  { href: '/', label: 'Accueil', Icon: HomeIcon },
  { href: '/explorer', label: 'Explorer', Icon: SearchIcon },
  { href: '/bibliotheque', label: 'Ma bibliothèque', Icon: ShelfIcon },
  { href: '/compte', label: 'Compte', Icon: UserIcon },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { track } = usePlayer();

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const isCurrent = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className={`shell${track ? ' has-mini' : ''}`}>
      <main id="contenu">{children}</main>
      <PlayerUI />
      <nav className="tabbar" aria-label="Navigation principale">
        <Link href="/" className="brand-side">Mirabel<i>u</i></Link>
        {TABS.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
