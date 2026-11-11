import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { PlayerProvider } from '@/lib/player';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mirabelu — livres audio à écouter et à appliquer', template: '%s — Mirabelu' },
  description: 'Écoutez des livres complets, puis retrouvez l’essentiel à comprendre et à appliquer. Abonnement trimestriel ou annuel, paiement Mobile Money.',
  applicationName: 'Mirabelu',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Mirabelu', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f3f2f7' }, { media: '(prefers-color-scheme: dark)', color: '#17102a' }],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <a href="#contenu" className="sr-only">Aller au contenu</a>
        <SessionProvider>
          <PlayerProvider>
            <Shell>{children}</Shell>
          </PlayerProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
