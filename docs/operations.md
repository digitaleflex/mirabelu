# Exploitation

## Variables obligatoires en production

`NODE_ENV=production` impose : `COOKIE_SECURE=true`, `OTP_DELIVERY=webhook` (avec `OTP_WEBHOOK_URL`), aucun prestataire `mock`, `JWT_SECRET` d'au moins 32 caractères. Liste complète : `.env.example`.

Derrière le proxy `/api` du site web, définir `REFRESH_COOKIE_PATH=/api/auth`. Le site doit connaître l'adresse interne de l'API via `API_URL`.

## Déploiement

1. Appliquer les migrations (cible Docker `migrate`, ou `pnpm db:migrate`) avant de démarrer la nouvelle version.
2. Démarrer `api`, `worker`, `web`. `GET /health` répond `{"status":"ok"}` sur l'API.
3. Définir `ADMIN_PHONES` avec les numéros des administrateurs : ils sont promus à leur première connexion. `ADMIN_PHONES` est la seule source des administrateurs : au démarrage de l'API, tout administrateur dont le numéro n'y figure plus est rétrogradé et ses sessions sont révoquées. Les administrateurs ne passent que par un code SMS : restreindre cette liste au strict nécessaire.
4. Régler `TRUST_PROXY_HOPS` sur le nombre réel de proxys devant l'API (1 = le site web ; +1 par répartiteur de charge). Une valeur trop haute permet de forger l'adresse IP et de contourner les limites de débit.

## Codes de connexion (passerelle OTP)

L'API envoie `POST OTP_WEBHOOK_URL` avec `Authorization: Bearer <OTP_WEBHOOK_TOKEN>` (si défini) et le corps JSON `{ "phone": "+229…", "code": "123456", "message": "Mirabelu : votre code…" }`. Une réponse non 2xx fait échouer la demande de code côté utilisateur. Brancher ici votre fournisseur SMS ou WhatsApp.

## Fraude aux SMS et limites de débit

La demande de code est limitée par numéro (30 s entre deux envois, 5 par heure), par IP, puis par deux plafonds globaux : `OTP_MAX_PER_HOUR_GLOBAL` (tous numéros) et `OTP_MAX_PER_HOUR_PER_PREFIX` (un pays). Dimensionnez-les sur votre trafic normal de connexions ; un dépassement journalise `plafond d’envoi OTP atteint` — c'est le signal d'une attaque ou d'un plafond trop bas. Activez aussi un plafond de dépense chez votre fournisseur SMS.

## Support : suspension, remboursements

- `POST /admin/users/:id/suspend` (motif obligatoire) coupe l'accès immédiatement (les jetons déjà émis sont refusés, les sessions révoquées) ; `…/unsuspend` le rétablit. Un administrateur ne peut pas être suspendu.
- `POST /admin/payments/:id/refund` : à appeler **après** avoir remboursé chez FedaPay/KKiaPay. Le paiement passe à `REFUNDED` et l'abonnement qu'il avait créé est annulé. Les abonnements enchaînés après celui-ci gardent leurs dates : vérifier le résultat dans `GET /admin/users/:id`.
- `POST /admin/subscriptions/:id/cancel` : annule un abonnement actif (fin immédiate).
- `GET /admin/users/:id` liste les paiements et abonnements d'un compte.

## Supervision

`GET /metrics` (format Prometheus) est désactivé tant que `METRICS_TOKEN` est vide ; sinon il exige `Authorization: Bearer <jeton>`. Il expose les requêtes par route et statut, leur durée cumulée, le nombre d'utilisateurs, d'abonnements actifs et d'imports en attente. Alertes conseillées : taux de 5xx, 429 sur `/auth/otp/request`, imports en attente qui ne baissent pas. Les conteneurs `api`, `web` et `worker` ont un healthcheck Docker.

## Imports audio

Déposer les fichiers dans `IMPORT_DIR` (volume partagé avec le worker), puis lancer l'import depuis l'espace admin. Tout chemin hors de ce dossier est refusé. Fichier maximal : `MAX_SOURCE_BYTES` (5 Gio : AURA n'accepte qu'un seul `PUT` par fichier).

## AURA Storage

- Utiliser une identité machine dédiée à Mirabelu (`AURA_API_TOKEN`) et un bucket à part.
- Les URL signées sont des capacités au porteur : ne jamais les journaliser, ne pas les afficher dans un outil de support.
- Surveiller le quota de sortie : chaque URL de lecture émise compte comme un téléchargement complet. Le cache de 780 s limite ce coût ; ne pas le réduire sans mesurer.

## Sauvegardes

`docker compose` lance un service `backup` : un `pg_dump` (format custom) par jour dans le volume `backups`, conservé `BACKUP_RETENTION_DAYS` jours (14 par défaut). Copiez ce volume hors du serveur (stockage objet, autre machine) : une sauvegarde sur le même disque ne protège pas d'une perte du serveur. Restauration : `pg_restore --clean --if-exists -d mirabelu fichier.dump`. À tester avant d'en avoir besoin.

Sont sauvegardés : données, abonnements, paiements, file de tâches. Les fichiers audio vivent dans AURA ; les originaux y sont conservés, ce qui permet de régénérer les versions de streaming.

## Service worker

`apps/web/public/sw.js` ne met en cache que les fichiers statiques et la page hors connexion, jamais l'API ni l'audio.
