import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig, devices, type ReporterDescription} from '@playwright/test';

/**
 * Le test de fumée contre une URL **réelle** (story 11) — `npm run test:smoke`,
 * qui passe par `scripts/smoke.mjs` (`--base-url`, `--behind-proxy`).
 *
 * Rien n'est construit ni démarré ici : pas de `webServer`, pas de simulateur,
 * pas de fixture. Le site visé sert son contenu réel, donc `tests/smoke/`
 * n'affirme que des **propriétés** — statuts, en-têtes, cookies, absence de
 * coordonnées — jamais un texte. Un seul worker, aucune reprise : chaque
 * requête est une visite journalisée par le site visé, autant en faire peu —
 * et qu'elles soient reconnaissables : l'agent utilisateur est
 * `cv-site-smoke/<version>`, ce que l'admin montre dans la colonne navigateur.
 * Aucune trace : elle contiendrait le contenu réel.
 *
 * `SMOKE_BASE_URL` est posée par `scripts/smoke.mjs` ; la refuser ici aussi
 * évite qu'un `playwright test --config playwright.smoke.config.ts` lancé à la
 * main parte sans cible. `SMOKE_BEHIND_PROXY=1` : les vérifications qui
 * dépendent de Caddy sont exigées ; sinon elles sont sautées (`test.skip` avec
 * la raison). `SMOKE_JSON_REPORT` (un chemin, posé par le lanceur) ajoute le
 * reporter `json` : c'est là que le lanceur relit les sauts — pour les compter
 * en fin d'exécution, et pour qu'un saut en mode proxy soit un échec.
 */
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) {
  throw new Error(
    'Test de fumée : URL cible requise — npm run test:smoke -- --base-url <url> (ou SMOKE_BASE_URL).'
  );
}

// `__dirname` et non `import.meta.url` : Playwright charge sa configuration en CommonJS.
const {version} = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {version: string};

const reporter: ReporterDescription[] = [['list']];
if (process.env.SMOKE_JSON_REPORT) reporter.push(['json', {outputFile: process.env.SMOKE_JSON_REPORT}]);

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter,
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'off',
    // Le certificat doit être bon : un défaut TLS est un échec, pas un détail.
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: 'smoke',
      // Au-dessus de 1024 px, le panneau de l'assistant est dans le premier
      // écran : pas de tiroir à ouvrir pour cliquer une puce. L'agent
      // utilisateur vient après le profil, qui en pose un.
      use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}, userAgent: `cv-site-smoke/${version}`}
    }
  ]
});
