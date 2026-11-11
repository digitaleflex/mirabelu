# Mirabelu

Plateforme de livres audio par abonnement pour l'Afrique francophone : écoute en streaming, résumés « Comprendre » et « Appliquer », paiement par Mobile Money (FedaPay et KKiaPay), stockage des fichiers sur AURA Storage.

## Architecture

Monorepo pnpm + Turborepo, TypeScript, PostgreSQL (sans Redis : la file de tâches utilise pg-boss).

| Dossier | Rôle |
|---|---|
| `apps/api` | API Fastify : authentification par OTP, catalogue, lecture, bibliothèque, paiements, administration |
| `apps/worker` | Import et conversion audio (ffmpeg → AAC 64 kbit/s mono, loudnorm) puis envoi vers AURA |
| `apps/web` | Site Next.js 16 (PWA) avec lecteur, mini-lecteur et espace admin |
| `packages/database` | Schéma Prisma, migrations SQL, file de tâches, base de test jetable |
| `packages/storage` | Client AURA (upload-intents, commit, preview-intent) + faux AURA pour les tests |
| `packages/billing` | FedaPay, KKiaPay, prestataire `mock` (dev/test), règlement idempotent |
| `packages/audio` | Sonde et conversion ffmpeg |
| `packages/config`, `packages/contracts` | Variables d'environnement validées, schémas partagés |
| `e2e` | Pile complète + 22 parcours navigateur (Playwright) |

Détails : [docs/architecture.md](docs/architecture.md).

## Démarrage en développement

Prérequis : Node ≥ 22.12, pnpm 10, PostgreSQL 16, ffmpeg.

```bash
pnpm install
cp .env.example .env          # renseigner DATABASE_URL, AURA_*, JWT_SECRET
pnpm db:generate
pnpm db:migrate
pnpm db:seed                  # catalogue de démonstration
pnpm dev                      # api :4000, worker, web :3000
```

En développement, `OTP_DELIVERY=console` affiche le code de connexion dans les logs de l'API et `PAYMENT_PROVIDERS=mock` permet de simuler un paiement. Ces deux réglages sont refusés au démarrage quand `NODE_ENV=production`.

## Vérifier

```bash
pnpm typecheck
pnpm test        # nécessite PostgreSQL (TEST_DATABASE_ADMIN_URL) et ffmpeg
pnpm build
```

Parcours navigateur complets : voir [e2e/README.md](e2e/README.md).

## Déploiement

`docker compose up --build` lance la base, les migrations, l'API, le worker et le site (voir `docker-compose.yml` et `infrastructure/docker/Dockerfile`). Guide d'exploitation : [docs/operations.md](docs/operations.md). Configuration des paiements : [docs/payments.md](docs/payments.md).

## Règles à ne pas casser

- Un livre n'est visible et lisible que s'il est `PUBLISHED` **et** que ses droits sont `VERIFIED`.
- Les URL signées AURA sont des capacités au porteur : jamais dans les logs.
- Un webhook de paiement n'est jamais cru : la transaction est toujours re-vérifiée auprès du prestataire (montant et référence compris).
- Aucun secret dans le dépôt (`.env` est ignoré).
