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
  allowedDevOrigins: devOrigins,
  // Un fichier `.md` du projet importé est sa chaîne, telle quelle (story 9 :
  // les textes des deux pages de prose), inlinée dans le bundle : elle survit
  // au build autonome sans lecture du disque à la requête. La déclaration
  // TypeScript correspondante est `src/types/markdown.d.ts`.
  //
  // **Deux règles jumelles, à faire évoluer ensemble.** Turbopack (le défaut)
  // et webpack (`next build --webpack`) passent tous deux par
  // `raw-text-loader.cjs`, à la racine — douze lignes, aucune dépendance ; le
  // type intégré `raw` de Turbopack rend un module sans export en 16.3, et
  // `asset/source` de webpack garderait une marque d'ordre des octets que le
  // chargeur retire —, `node_modules` exclu des deux côtés. L'une sans
  // l'autre, et l'un des deux bundlers casserait sur le premier import de
  // `.md`.
  turbopack: {
    rules: {
      '*.md': {condition: {not: 'foreign'}, loaders: ['./raw-text-loader.cjs'], as: '*.js'}
    }
  },
  webpack: (config) => {
    config.module.rules.push({test: /\.md$/, exclude: /node_modules/, use: ['./raw-text-loader.cjs']});
    return config;
  },
  experimental: {
    // Deux racines (`(site)`, `(admin)`) et aucun layout au sommet : la 404
    // des URL sans route est `src/app/global-not-found.tsx`, servie comme un
    // document complet — voir le commentaire de ce fichier.
    globalNotFound: true
  }
};

// Branche `src/i18n/request.ts` (AD-5).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
