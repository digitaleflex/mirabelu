# Parcours navigateur

`src/stack.ts` démarre une base jetable, un faux AURA, un faux fournisseur OTP, l'API et le worker sur :4000. `src/flows.ts` pilote ensuite le site (lancé sur :3000) avec Playwright et vérifie 22 parcours : accueil, connexion OTP, abonnement, lecture, bibliothèque, favoris, PWA, espace admin, droits.

```bash
CSP_MEDIA_EXTRA='http://127.0.0.1:*' pnpm --filter @mirabelu/web build   # le faux AURA des tests est en http
(cd e2e && pnpm exec tsx src/stack.ts) &
(cd apps/web && API_URL=http://127.0.0.1:4000 pnpm exec next start -p 3000) &
cd e2e && pnpm exec tsx src/flows.ts
```

Si le Chromium de Playwright n'est pas installé dans la version attendue, pointer vers un autre exécutable avec `E2E_CHROMIUM=/chemin/vers/chrome`.

Limite connue : le Chromium « headless shell » ne décode pas l'AAC. Les parcours vérifient donc la demande d'URL signée et la récupération du fichier en `Range`, pas la lecture sonore elle-même (à tester à la main dans un vrai navigateur).
