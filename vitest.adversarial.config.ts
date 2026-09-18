import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

/**
 * La suite adverse contre l'API **réelle** (story 10, AD-12) — `npm run
 * test:adversarial`, **hors** `verify`, sur demande explicite : chaque
 * exécution coûte de l'argent.
 *
 * Pas de `tests/setup-env.ts` ici : il pointerait la passerelle sur un port
 * fermé et le contenu sur la fixture. C'est le test lui-même qui complète
 * l'environnement depuis `.env.local` — sans jamais lire la clé — et refuse de
 * démarrer si `ANTHROPIC_BASE_URL` est posée ou si le jeu manque.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/adversarial/**/*.test.ts'],
    // Vingt-quatre appels réels, deux minutes au plus chacun : une heure de marge.
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // Le reporter par défaut retient les `console.*` d'un test vert : ici, les
    // lignes `adversarial.case` et `agent.exchange_done` se lisent au fil de l'eau.
    reporters: ['verbose'],
    server: {
      deps: {
        // Même raison que `vitest.config.ts` : `next-intl` importe `next/server` en ESM.
        inline: ['next-intl']
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url))
    }
  }
});
