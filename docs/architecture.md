# Architecture

## Flux principaux

**Connexion.** Téléphone + code à 6 chiffres (haché HMAC, valable 10 min, 5 essais, 30 s entre deux demandes, 5 par heure). L'API émet un jeton d'accès JWT HS256 de 15 min (gardé en mémoire côté web) et un cookie de session `mb_refresh` (httpOnly) rotatif. Réutiliser un ancien cookie hors de la tolérance de 30 s révoque la famille de sessions. Le rôle admin est relu en base à chaque appel `/admin`.

**Lecture.** Le site demande `/books/:id/chapters/:n/playback`. L'API vérifie abonnement, territoire, livre `PUBLISHED` + droits `VERIFIED`, puis demande une `preview-intent` à AURA et renvoie l'URL signée. Chaque intent compte comme un téléchargement complet dans le quota de sortie d'AURA : l'URL est donc mise en cache côté serveur par utilisateur et par livre (~780 s) et renouvelée avec au moins 120 s de marge. Le lecteur redemande une URL sur erreur ou après une pause longue (avec garde anti-boucle).

**Import audio.** `POST /admin/imports` crée une tâche pg-boss. Le worker lit le fichier (chemin confiné à `IMPORT_DIR` via `realpath`), calcule le sha256 (dédoublonnage), convertit en AAC-LC mono 64 kbit/s `.m4a` faststart avec normalisation du volume, envoie l'original et la version de streaming vers AURA (`upload-intents` → `PUT` présigné avec les en-têtes exacts → `commit`, 200 ou 202 puis sondage). Un livre importé n'est jamais publié automatiquement. L'idempotence est gérée dans le traitement, pas par la file.

**Paiement.** `/billing/checkout` crée un `Payment` en attente, puis :
- FedaPay : redirection vers la page de paiement ; retour sur `/abonnement/retour`.
- KKiaPay : widget côté navigateur, qui renvoie un `transactionId` que le site transmet à l'API.
- Dans les deux cas, le règlement (`settlePayment`) re-vérifie la transaction auprès du prestataire (statut, montant, référence = `paymentId`) et prolonge l'abonnement dans une transaction SQL, une seule fois même si webhook et retour arrivent en même temps. Un nouvel abonnement prolonge à partir de la fin du précédent.

Offres : 7 500 FCFA / 3 mois et 25 000 FCFA / 12 mois.

## Règles de contenu

- Visible et lisible seulement si `PUBLISHED` et droits `VERIFIED` ; retirer les droits dépublie.
- Publication : droits vérifiés + au moins un fichier de streaming.
- Territoires déduits du préfixe du numéro de téléphone.
- Abonnement requis pour écouter et lire les résumés ; les admins en sont dispensés.

## Choix techniques

- PostgreSQL seul : données et file de tâches (pg-boss), pas de Redis.
- Migrations SQL écrites à la main et appliquées par `prisma migrate deploy` ; la CI vérifie qu'elles correspondent au schéma Prisma.
- Les paquets internes exportent du TypeScript ; les bundles `tsup` de l'API et du worker les embarquent et gardent toutes les dépendances tierces externes.
- Le site proxifie l'API sous `/api` : un seul domaine, cookie de session « same-site ».
