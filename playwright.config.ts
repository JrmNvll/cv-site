import {defineConfig, devices} from '@playwright/test';

/**
 * Vérification navigateur du socle : redirection de langue, balise `noindex`,
 * cookies de visite. Playwright lance lui-même le serveur de développement.
 */
// `||` et non `??` : une variable présente mais vide donnerait `http://:3000`.
const HOST = process.env.HOSTNAME || '127.0.0.1';
const PORT = process.env.PORT || '3000';
const baseURL = `http://${HOST}:${PORT}`;

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
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    // Build de **production**, pas `next dev` : le serveur de développement
    // réécrit `Cache-Control` pour son rechargement à chaud, et masquerait donc
    // l'en-tête posé par `proxy.ts`. On vérifie l'artefact qui part en ligne.
    command: 'npm run build && npm run start',
    url: baseURL,
    // Toujours un serveur neuf : la vérification ne doit pas dépendre d'un
    // serveur déjà lancé avec une autre configuration.
    reuseExistingServer: false,
    timeout: 180_000,
    // Configuration explicite : sans elle, le serveur hériterait du `.env.local`
    // du poste et l'assertion sur `/admin` dépendrait de la machine.
    env: {
      HOSTNAME: HOST,
      PORT,
      ADMIN_DEV: '0',
      ANTHROPIC_API_KEY: 'cle-de-test-sans-valeur',
      CONTENT_DIR: 'tests/fixtures/content',
      DATA_DIR: 'tests/fixtures/data',
      NEXT_PUBLIC_SITE_URL: baseURL
    }
  }
});
