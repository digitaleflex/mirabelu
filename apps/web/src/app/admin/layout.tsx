'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireAdmin } from '@/components/guards';

const LINKS = [
  { href: '/admin', label: 'Tableau de bord' },
  { href: '/admin/livres', label: 'Livres' },
  { href: '/admin/imports', label: 'Imports' },
  { href: '/admin/utilisateurs', label: 'Abonnés' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <RequireAdmin>
      <div className="page wide" style={{ paddingBottom: 0 }}>
        <nav className="chips" aria-label="Administration">
          {LINKS.map((l) => (
            <Link key={l.href} className="chip" href={l.href} aria-current={(l.href === '/admin' ? path === '/admin' : path.startsWith(l.href)) ? 'true' : undefined}>{l.label}</Link>
          ))}
        </nav>
      </div>
      {children}
    </RequireAdmin>
  );
}
