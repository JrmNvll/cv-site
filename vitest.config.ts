import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    server: {
      deps: {
        // next-intl importe `next/server` en ESM : laisser Vite le résoudre par
        // la carte d'exports de Next plutôt que par le résolveur de Node.
        inline: ['next-intl']
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` lève une erreur hors contexte React Server : c'est son
      // rôle dans le bundle Next, pas dans un test unitaire Node.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url))
    }
  }
});
