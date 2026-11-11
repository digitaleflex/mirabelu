/**
 * Parcours de bout en bout dans un vrai navigateur (Chromium), contre la pile `stack.ts` + le site web.
 *   E2E_WEB=http://localhost:3000 pnpm --filter @mirabelu/e2e flows
 * Playwright est résolu depuis le projet ; PLAYWRIGHT_PATH permet d'utiliser une installation existante.
 */
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
type PW = typeof import('playwright');
let pw: PW;
pw = require(process.env.PLAYWRIGHT_PATH ?? 'playwright') as PW;

const WEB = process.env.E2E_WEB ?? 'http://localhost:3000';
const OTP_FILE = process.env.E2E_OTP_FILE ?? join(tmpdir(), 'mirabelu-e2e-otp.json');
const SHOTS = process.env.E2E_SHOTS ?? '/tmp/shots';

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); console.log(`✔ ${name}`); }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message.split('\n')[0] }); console.log(`✘ ${name}\n    ${(e as Error).message.split('\n').slice(0, 3).join('\n    ')}`); }
}

const browser = await pw.chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});

async function login(page: import('playwright').Page, phone: string, next: string): Promise<void> {
  rmSync(OTP_FILE, { force: true });
  await page.goto(`${WEB}/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code à 6 chiffres').waitFor();
  const { code } = JSON.parse(readFileSync(OTP_FILE, 'utf8')) as { code: string };
  await page.getByLabel('Code à 6 chiffres').fill(code);
  await page.getByRole('button', { name: 'Valider' }).click();
}

// --- Abonné sur mobile ---------------------------------------------------------------------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fr-FR' });
const page = await ctx.newPage();
const consoleErrors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const audioRequests: { url: string; status: number; range: string | undefined }[] = [];
page.on('response', (r) => { if (r.url().includes('/s3/')) audioRequests.push({ url: r.url(), status: r.status(), range: r.request().headers().range }); });

await step('accueil anonyme : titre, offre et livre à la une', async () => {
  await page.goto(WEB);
  await page.getByRole('heading', { name: /Écoutez le livre/ }).waitFor();
  await page.getByRole('link', { name: 'Voir les formules' }).waitFor();
  await page.getByRole('link', { name: /Le pouvoir des habitudes/ }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/01-accueil.png` });
});

await step('explorer : recherche par auteur', async () => {
  await page.goto(`${WEB}/explorer`);
  await page.getByLabel('Titre ou auteur').fill('duhigg');
  await page.getByRole('link', { name: /Le pouvoir des habitudes/ }).waitFor();
  await page.getByLabel('Titre ou auteur').fill('introuvable-xyz');
  await page.getByText('Aucun livre trouvé').waitFor();
});

await step('fiche livre anonyme : invitation à se connecter, chapitres verrouillés', async () => {
  await page.goto(`${WEB}/livre/le-pouvoir-des-habitudes`);
  await page.getByRole('heading', { name: 'Le pouvoir des habitudes' }).waitFor();
  await page.getByRole('link', { name: 'Se connecter pour écouter' }).waitFor();
  await page.getByText('Les quatre lois').waitFor();
  await page.screenshot({ path: `${SHOTS}/02-livre-anonyme.png` });
});

await step('connexion par OTP puis retour sur la fiche', async () => {
  await login(page, '01 97 00 00 11', '/livre/le-pouvoir-des-habitudes');
  await page.getByRole('link', { name: 'S’abonner pour écouter' }).waitFor();
  await page.screenshot({ path: `${SHOTS}/03-connecte.png` });
});

await step('un mauvais code est refusé avec un message clair', async () => {
  const fresh = await browser.newContext({ locale: 'fr-FR' }); // sans session
  const p2 = await fresh.newPage();
  await p2.goto(`${WEB}/connexion`);
  await p2.getByLabel('Numéro de téléphone').fill('01 97 00 00 12');
  await p2.getByRole('button', { name: 'Recevoir le code' }).click();
  await p2.getByLabel('Code à 6 chiffres').fill('000000');
  await p2.getByRole('button', { name: 'Valider' }).click();
  await p2.getByRole('alert').getByText(/invalide|expiré/).waitFor();
  await fresh.close();
});

await step('les résumés sont réservés aux abonnés', async () => {
  await page.getByRole('tab', { name: 'Comprendre' }).click();
  await page.getByText('Réservé aux abonnés').waitFor();
});

await step('abonnement (paiement simulé) → activé', async () => {
  await page.getByRole('link', { name: 'S’abonner pour écouter' }).click();
  await page.getByRole('heading', { name: 'S’abonner' }).waitFor();
  await page.getByRole('button', { name: /Annuelle/ }).waitFor();
  await page.screenshot({ path: `${SHOTS}/04-abonnement.png` });
  await page.getByRole('button', { name: /Payer 25 000 FCFA/ }).click();
  await page.getByText('Bienvenue, c’est activé.').waitFor();
});

await step('résumés « Comprendre » et « Appliquer » lisibles', async () => {
  await page.goto(`${WEB}/livre/le-pouvoir-des-habitudes`);
  await page.getByRole('tab', { name: 'Comprendre' }).click();
  await page.getByText('signal', { exact: false }).first().waitFor();
  await page.getByRole('tab', { name: 'Appliquer' }).click();
  await page.getByText('Gardez le signal').waitFor();
  await page.screenshot({ path: `${SHOTS}/05-resume.png` });
});

await step('lecture : URL signée demandée, fichier AAC récupéré en Range, lecteur ouvert', async () => {
  await page.getByRole('tab', { name: 'Chapitres' }).click();
  const playbackCall = page.waitForResponse((r) => r.url().includes('/playback/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Écouter/ }).click();
  const res = await playbackCall;
  if (res.status() !== 200) throw new Error(`playback ${res.status()}`);
  await page.getByRole('dialog', { name: /Lecture de Le pouvoir des habitudes/ }).waitFor();
  await page.waitForTimeout(1500);
  if (audioRequests.length === 0) throw new Error('aucune requête audio vers le stockage');
  if (!audioRequests.every((r) => r.status === 200 || r.status === 206)) throw new Error(`statuts audio : ${audioRequests.map((r) => r.status)}`);
  await page.screenshot({ path: `${SHOTS}/06-lecteur.png` });
});

await step('le lecteur se réduit en mini-lecteur et la navigation continue', async () => {
  await page.getByRole('button', { name: 'Réduire le lecteur' }).click();
  await page.getByRole('region', { name: 'Lecteur' }).waitFor();
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByRole('region', { name: 'Lecteur' }).waitFor();
  await page.screenshot({ path: `${SHOTS}/07-mini-lecteur.png` });
});

await step('la progression est enregistrée côté serveur', async () => {
  await page.getByRole('button', { name: /Ouvrir le lecteur/ }).click();
  await page.getByLabel('Position dans le livre').fill('35');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/06b-lecteur-avance.png` });
  const saved = page.waitForResponse((r) => r.url().includes('/library/progress/') && r.request().method() === 'PUT', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrêter' }).click(); // pause + sauvegarde
  const r = await saved;
  if (r.status() !== 200) throw new Error(`progress ${r.status()}`);
});

await step('bibliothèque : le livre apparaît en cours avec sa progression', async () => {
  await page.goto(`${WEB}/bibliotheque`);
  await page.getByRole('link', { name: /Le pouvoir des habitudes/ }).waitFor();
  await page.screenshot({ path: `${SHOTS}/08-bibliotheque.png` });
});

await step('favoris : ajout depuis la fiche', async () => {
  await page.goto(`${WEB}/livre/le-pouvoir-des-habitudes`);
  await page.getByRole('button', { name: 'Ajouter aux favoris' }).click();
  await page.getByRole('button', { name: 'Dans mes favoris' }).waitFor();
  await page.goto(`${WEB}/bibliotheque`);
  await page.getByRole('tab', { name: 'Favoris' }).click();
  await page.getByRole('link', { name: /Le pouvoir des habitudes/ }).waitFor();
});

await step('la session survit à un rechargement (cookie de session)', async () => {
  await page.goto(`${WEB}/compte`);
  await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
  await page.getByText(/Actif jusqu’au/).waitFor();
  await page.screenshot({ path: `${SHOTS}/09-compte.png` });
});

await step('déconnexion', async () => {
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.getByRole('link', { name: 'Voir les formules' }).waitFor();
  await page.goto(`${WEB}/compte`);
  await page.getByRole('heading', { name: 'Connectez-vous' }).waitFor();
});

await step('PWA : manifeste, icônes et page hors connexion servis', async () => {
  for (const path of ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/offline.html', '/sw.js']) {
    const r = await ctx.request.get(`${WEB}${path}`);
    if (!r.ok()) throw new Error(`${path} → ${r.status()}`);
  }
  const m = (await (await ctx.request.get(`${WEB}/manifest.webmanifest`)).json()) as { display: string; icons: unknown[] };
  if (m.display !== 'standalone' || m.icons.length < 3) throw new Error('manifeste incomplet');
});

// --- Utilisateur ordinaire face à l'admin ---------------------------------------------------
await step('un abonné ordinaire ne voit pas l’espace admin', async () => {
  await login(page, '01 97 00 00 13', '/admin');
  await page.getByText('Cet espace est réservé aux administrateurs.').waitFor();
});

// --- Administrateur ----------------------------------------------------------------------------
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
const admin = await adminCtx.newPage();
await step('admin : tableau de bord et chiffres', async () => {
  await login(admin, '+229 01 00 00 00 99', '/admin');
  await admin.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await admin.getByText('abonnés actifs').waitFor();
  await admin.screenshot({ path: `${SHOTS}/10-admin.png` });
});
await step('admin : fiche livre, droits et publication', async () => {
  await admin.goto(`${WEB}/admin/livres`);
  await admin.getByRole('link', { name: 'Le pouvoir des habitudes' }).click();
  await admin.getByRole('heading', { name: 'Droits' }).waitFor();
  await admin.getByRole('button', { name: 'Retirer du catalogue' }).click();
  await admin.getByText('Livre retiré du catalogue.').waitFor();
  await admin.getByRole('button', { name: 'Publier' }).click();
  await admin.getByText('Livre publié.').waitFor();
  await admin.screenshot({ path: `${SHOTS}/11-admin-livre.png`, fullPage: true });
});
await step('admin : un import hors du dossier est refusé', async () => {
  await admin.goto(`${WEB}/admin/imports`);
  await admin.getByLabel(/Fichiers à importer/).fill('../../etc/passwd');
  await admin.getByRole('button', { name: 'Lancer l’import' }).click();
  await admin.getByRole('alert').getByText(/Chemin/).waitFor();
});
await step('admin : liste des abonnés', async () => {
  await admin.goto(`${WEB}/admin/utilisateurs`);
  await admin.getByText('+2290197000011').waitFor();
});

await step('aucune erreur JavaScript inattendue dans la console', async () => {
  const relevant = consoleErrors.filter((e) => !/Failed to load resource|MEDIA_ELEMENT_ERROR|net::ERR/.test(e));
  if (relevant.length) throw new Error(relevant.slice(0, 3).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} parcours réussis`);
process.exit(failed.length ? 1 : 0);
