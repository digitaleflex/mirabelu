# syntax=docker/dockerfile:1.7
# Cibles : migrate · api · worker · web
# Construire depuis la racine : docker build -f infrastructure/docker/Dockerfile --target api .

ARG NODE_VERSION=22.12
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- Dépendances complètes + build ------------------------------------------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @mirabelu/database generate \
    && pnpm --filter @mirabelu/api --filter @mirabelu/worker --filter @mirabelu/web build

# --- Dépendances de production (api + worker) -------------------------------
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @mirabelu/api... --filter @mirabelu/worker...

# --- Migrations (Prisma CLI, exécutée une fois par déploiement) ---------------
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /app/packages/database
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# --- API ---------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# --- Worker (ffmpeg requis) -----------------------------------------------------
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/imports /tmp/mirabelu-worker && chown -R node:node /data /tmp/mirabelu-worker
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY apps/worker/package.json ./apps/worker/package.json
USER node
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

# --- Site web ------------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
