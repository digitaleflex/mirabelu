# Exploitation

## Variables obligatoires en production

`NODE_ENV=production` impose : `COOKIE_SECURE=true`, `OTP_DELIVERY=webhook` (avec `OTP_WEBHOOK_URL`), aucun prestataire `mock`, `JWT_SECRET` d'au moins 32 caractères. Liste complète : `.env.example`.

Derrière le proxy `/api` du site web, définir `REFRESH_COOKIE_PATH=/api/auth`. Le site doit connaître l'adresse interne de l'API via `API_URL`.

## Déploiement

1. Appliquer les migrations (cible Docker `migrate`, ou `pnpm db:migrate`) avant de démarrer la nouvelle version.
2. Démarrer `api`, `worker`, `web`. `GET /health` répond `{"status":"ok"}` sur l'API.
3. Définir `ADMIN_PHONES` avec les numéros des administrateurs : ils sont promus à leur première connexion.

## Codes de connexion (passerelle OTP)

L'API envoie `POST OTP_WEBHOOK_URL` avec `Authorization: Bearer <OTP_WEBHOOK_TOKEN>` (si défini) et le corps JSON `{ "phone": "+229…", "code": "123456", "message": "Mirabelu : votre code…" }`. Une réponse non 2xx fait échouer la demande de code côté utilisateur. Brancher ici votre fournisseur SMS ou WhatsApp.

## Imports audio

Déposer les fichiers dans `IMPORT_DIR` (volume partagé avec le worker), puis lancer l'import depuis l'espace admin. Tout chemin hors de ce dossier est refusé. Fichier maximal : `MAX_SOURCE_BYTES` (5 Gio : AURA n'accepte qu'un seul `PUT` par fichier).

## AURA Storage

- Utiliser une identité machine dédiée à Mirabelu (`AURA_API_TOKEN`) et un bucket à part.
- Les URL signées sont des capacités au porteur : ne jamais les journaliser, ne pas les afficher dans un outil de support.
- Surveiller le quota de sortie : chaque URL de lecture émise compte comme un téléchargement complet. Le cache de 780 s limite ce coût ; ne pas le réduire sans mesurer.

## Sauvegardes

Sauvegarder PostgreSQL (données, abonnements, paiements, file de tâches). Les fichiers audio vivent dans AURA ; les originaux y sont conservés, ce qui permet de régénérer les versions de streaming.

## Service worker

`apps/web/public/sw.js` ne met en cache que les fichiers statiques et la page hors connexion, jamais l'API ni l'audio.
