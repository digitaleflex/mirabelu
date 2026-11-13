import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const isDev = process.env.NODE_ENV !== 'production';
/** Sources audio supplémentaires, lues au build (ex. faux stockage http://127.0.0.1:* des tests e2e). Vide en production. */
const MEDIA_EXTRA = (process.env.CSP_MEDIA_EXTRA ?? '').trim();

/**
 * Politique de sécurité du contenu. Next injecte des scripts en ligne d'hydratation, d'où 'unsafe-inline'
 * pour les scripts (un nonce imposerait un rendu dynamique de toutes les pages) ; le reste est verrouillé :
 * pas d'objets, pas de <base>, pas d'encadrement du site, formulaires et connexions limités.
 * KKiaPay : script + iframe + appels API ; l'audio vient d'URL signées AURA (https) ; les couvertures sont en https.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://cdn.kkiapay.me`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `media-src 'self' blob: https:${MEDIA_EXTRA ? ` ${MEDIA_EXTRA}` : ''}`,
  "font-src 'self' data:",
  `connect-src 'self' https://*.kkiapay.me${isDev ? ' ws:' : ''}`,
  "frame-src https://*.kkiapay.me",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@mirabelu/contracts'],
  poweredByHeader: false,
  async rewrites() {
    // L'API est servie sous /api sur la même origine : le cookie de session reste « same-site ».
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default config;
