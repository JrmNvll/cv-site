import {mkdirSync, readFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig, devices} from '@playwright/test';

/**
 * Vérification navigateur : redirection de langue, balise `noindex`, cookies
 * de visite, journal des visites, questions du premier écran, et l'assistant
 * — contre un **simulateur** de l'API du modèle. Playwright construit et lance
 * lui-même l'artefact de production, et le simulateur avec lui.
 */
// `||` et non `??` : une variable présente mais vide donnerait `http://:3000`.
const HOST = process.env.HOSTNAME || '127.0.0.1';
const PORT = process.env.PORT || '3000';
const baseURL = `http://${HOST}:${PORT}`;

/**
 * Le simulateur du modèle (`tests/e2e/model-stub/server.mjs`) : le site lui
 * parle par `ANTHROPIC_BASE_URL`, le SDK réel fait le reste, rien n'est
 * facturé. Un appel réel n'a lieu qu'en story 10, sur demande. Le port vient
 * du même fichier que les scénarios, pour que les tests et le serveur lisent
 * la même valeur.
 */
const STUB_PORT = String(
  process.env.MODEL_STUB_PORT ||
    (JSON.parse(readFileSync(resolve(__dirname, 'tests/e2e/model-stub/scenarios.json'), 'utf8')) as {port: number})
      .port
);
const stubURL = `http://127.0.0.1:${STUB_PORT}`;

/**
 * Chemins **absolus**, résolus depuis ce fichier — pas depuis le répertoire
 * courant, qui dépend d'où la commande est lancée. `server.js` du build autonome
 * se place dans `.next/standalone` avant de démarrer : un chemin relatif y
 * désignerait un répertoire inexistant, et le démarrage échouerait — à raison
 * (AD-2, et `src/env.ts` refuse désormais un `CONTENT_DIR` relatif).
 *
 * `__dirname` et non `import.meta.url` : Playwright charge sa configuration en
 * CommonJS, où `import.meta` est une erreur de syntaxe.
 */
const FIXTURES = resolve(__dirname, 'tests/fixtures/content');
const DATA = resolve(__dirname, 'tests/fixtures/data');

/**
 * `DATA_DIR` doit exister **avant** le démarrage : le site refuse de le créer
 * et s'arrête s'il manque (AD-7, AD-9). Le répertoire est ignoré par Git
 * (`data/`, `*.db*`), donc absent d'un clone neuf — et Playwright lance le
 * serveur avant `globalSetup`, ce qui ne laisse que la configuration elle-même
 * pour le créer. `usage.db` est effacé ici à chaque exécution : une base
 * laissée par une autre branche, à un autre schéma, ferait refuser le
 * démarrage, et chaque exécution repart de zéro.
 */
mkdirSync(DATA, {recursive: true});
// Dans le processus principal seulement : Playwright recharge cette
// configuration dans chaque worker, alors que le serveur tient déjà la base
// ouverte — la supprimer là échouerait (EPERM sous Windows), et pour rien.
if (process.env.TEST_WORKER_INDEX === undefined) {
  for (const name of ['usage.db', 'usage.db-wal', 'usage.db-shm']) {
    rmSync(resolve(DATA, name), {force: true});
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome']}, testIgnore: /chat-cap\.spec\.ts/},
    // Le plafond, **en dernier et isolé** : une fois la dépense du mois
    // au-dessus de 5 USD dans `usage.db`, plus aucune question ne passe —
    // tout ce qui appelle le modèle doit avoir tourné avant.
    {
      name: 'chromium-plafond',
      use: {...devices['Desktop Chrome']},
      testMatch: /chat-cap\.spec\.ts/,
      dependencies: ['chromium'],
      // Pas rejouable : une reprise trouverait la dépense déjà en base et
      // recevrait `503` dès la première question — elle ne prouverait rien.
      retries: 0
    }
  ],
  webServer: [
    {
      // Le simulateur d'abord : le site doit pouvoir lui parler dès sa première question.
      command: 'node tests/e2e/model-stub/server.mjs',
      url: `${stubURL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {MODEL_STUB_PORT: STUB_PORT}
    },
    {
      // Build de **production**, pas `next dev` : le serveur de développement
      // réécrit `Cache-Control` pour son rechargement à chaud, et masquerait donc
      // l'en-tête posé par `proxy.ts`. On vérifie l'artefact qui part en ligne.
      command: 'npm run build && npm run start',
      url: baseURL,
      // Toujours un serveur neuf : la vérification ne doit pas dépendre d'un
      // serveur déjà lancé avec une autre configuration.
      reuseExistingServer: false,
      timeout: 180_000,
      // Configuration explicite, et `start.mjs` ne lit **pas** `.env.local`
      // (`START_SKIP_ENV_FILE`) : le serveur ne dépend de rien d'autre que ce
      // qui est écrit ici — l'assertion sur `/admin` ne dépend pas du poste, et
      // la suite est hermétique avec ou sans `.env.local`.
      env: {
        START_SKIP_ENV_FILE: '1',
        HOSTNAME: HOST,
        PORT,
        ADMIN_DEV: '0',
        ANTHROPIC_API_KEY: 'cle-de-test-sans-valeur',
        ANTHROPIC_BASE_URL: stubURL,
        CONTENT_DIR: FIXTURES,
        DATA_DIR: DATA,
        NEXT_PUBLIC_SITE_URL: baseURL
      }
    }
  ]
});
