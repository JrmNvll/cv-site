import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Origines autorisées pour les ressources internes du serveur de développement.
 *
 * Volontairement lu depuis `process.env` sans passer par `src/env.ts` : la
 * validation Zod appartient au **démarrage** (`src/instrumentation.ts`), pas au
 * build. Un `next build` en intégration continue ou sur un poste neuf ne doit
 * exiger ni clé API, ni chemin de contenu.
 */
const devOrigins: string[] = [
  ...new Set(['localhost', '127.0.0.1', process.env.HOSTNAME].filter((host): host is string =>
    Boolean(host)
  ))
];

const nextConfig: NextConfig = {
  // AD-1 / AD-13 : un seul processus, lancé par `node server.js` depuis le build
  // autonome recopié sur le VPS.
  output: 'standalone',
  // Rien ne renseigne un visiteur sur la pile technique côté en-têtes.
  poweredByHeader: false,
  // En développement, l'application est servie sur l'interface d'écoute
  // configurée (AD-10) et pas seulement sur `localhost`.
  allowedDevOrigins: devOrigins
};

// Branche `src/i18n/request.ts` (AD-5).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
