/**
 * Routage bilingue — AD-5 : la langue est portée par le préfixe d'URL.
 *
 * `localePrefix: 'always'` : `/fr` et `/en` sont toujours explicites, `/` redirige.
 * `localeDetection: false` : la racine mène **toujours** à `/fr` (matrice de la
 * story : « GET / → redirection vers /fr »). Le choix de langue est un geste
 * explicite du visiteur, pas une négociation d'en-tête ; cela garde aussi `/en`
 * hors du chemin par défaut tant que la relecture anglaise n'est pas faite.
 * `localeCookie: false` : `proxy.ts` reste le seul à poser des cookies.
 */
import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  localePrefix: 'always',
  localeDetection: false,
  localeCookie: false
});

export type Locale = (typeof routing.locales)[number];
