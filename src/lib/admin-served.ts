/**
 * La porte de l'admin (AD-10) — une seule règle, lue à deux endroits :
 * `src/proxy.ts`, qui répond `404` sur tout document `/admin*` quand elle est
 * fermée, et `mutation-route.ts`, qui la revérifie avant toute écriture — la
 * ceinture, pour le jour où une route échapperait au matcher du proxy.
 *
 * En production, `/admin*` est toujours servi : c'est Caddy qui protège. En
 * développement, il n'existe que si `ADMIN_DEV=1`. La configuration est
 * **passée** en paramètre : ce module ne charge pas `@/env`, dont le parsage
 * a lieu au chargement et ne doit pas être entraîné au build par une route.
 */
export function isAdminServed(config: {readonly ADMIN_DEV: boolean}): boolean {
  return config.ADMIN_DEV || process.env.NODE_ENV === 'production';
}
