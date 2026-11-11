import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Les paquets du monorepo exportent du TypeScript : on les embarque dans le bundle.
  // Toutes les dépendances tierces restent externes (déclarées dans package.json)
  // pour que Prisma, pg et fastify se résolvent depuis node_modules à l'exécution.
  noExternal: [/^@mirabelu\//],
  external: [/^(?!@mirabelu\/|\.|\/|[A-Za-z]:)[^:]+$/, /^node:/],
});
