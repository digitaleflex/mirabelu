import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mirabelu',
    short_name: 'Mirabelu',
    description: 'Livres audio à écouter et à appliquer.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fr',
    background_color: '#17102a',
    theme_color: '#1f1633',
    categories: ['books', 'education'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
