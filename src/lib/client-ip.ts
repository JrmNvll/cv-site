/**
 * L'adresse du client — AD-15 : une seule source, une seule fonction.
 *
 * En production, Caddy est la seule porte publique (AD-10) et pose `X-Client-IP`
 * depuis sa variable `client_ip`, en **écrasant** toute valeur entrante : que le
 * proxy Cloudflare soit actif ou non, c'est la seule chaîne de confiance, et
 * elle est configurée là, pas ici. Aucun autre en-tête n'est lu — en
 * particulier pas celui que n'importe quel client peut forger en amont.
 *
 * Hors production, il n'y a pas de Caddy : l'adresse vaut `'dev'`, et le
 * journal comme le limiteur la reçoivent telle quelle. Ils ne lisent jamais la
 * requête eux-mêmes ; c'est `app` qui appelle cette fonction et leur passe le
 * résultat.
 */

/** L'en-tête que Caddy pose. La lecture est insensible à la casse. */
import {isIP} from 'node:net';

export const CLIENT_IP_HEADER = 'X-Client-IP';
/** Hors production : pas de Caddy, pas d'adresse. */
export const DEV_CLIENT_IP = 'dev';
/** En production sans l'en-tête : Caddy est mal configuré, l'adresse est inconnue. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/**
 * L'avertissement part une fois par processus, pas une fois par requête — ni
 * une fois par copie du module : Turbopack en charge une par graphe serveur
 * (pages, routes), d'où le drapeau sur `globalThis` plutôt qu'en variable de
 * module.
 */
type Reported = {missingHeader: boolean};
const REPORTED = Symbol.for('cv-site.client-ip.reported');
const reported: Reported = ((globalThis as unknown as Record<symbol, Reported | undefined>)[
  REPORTED
] ??= {missingHeader: false});

export function clientIp(headers: Headers): string {
  if (process.env.NODE_ENV !== 'production') {
    return DEV_CLIENT_IP;
  }

  // Une adresse, et rien d'autre : un Caddy qui ajouterait l'en-tête au lieu
  // de l'écraser produirait une liste « a, b », qu'on n'écrit pas en base.
  const value = headers.get(CLIENT_IP_HEADER)?.trim();
  if (value && isIP(value) !== 0) {
    return value;
  }

  if (!reported.missingHeader) {
    reported.missingHeader = true;
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'client_ip.header_missing',
        header: CLIENT_IP_HEADER,
        text: `En-tête ${CLIENT_IP_HEADER} absent en production : Caddy doit le poser (AD-15). Les adresses sont enregistrées comme « ${UNKNOWN_CLIENT_IP} ».`
      })
    );
  }
  return UNKNOWN_CLIENT_IP;
}
