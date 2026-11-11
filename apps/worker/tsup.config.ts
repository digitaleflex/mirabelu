import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Les paquets du monorepo exportent du TypeScript : on les embarque dans le bundle.
  noExternal: [/^@mirabelu\//],
});
