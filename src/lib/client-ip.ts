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

/**
 * La clé sous laquelle une adresse se bloque (story 13), ou `null` quand elle
 * ne se bloque pas.
 *
 * Trois raisons de ne pas prendre l'adresse telle quelle :
 *
 *  - `dev` et `unknown` ne désignent personne. `unknown` est **porté par les
 *    sondes de santé de `deploy.ps1`**, qui n'arrivent pas par Caddy : le
 *    bloquer fermerait le site à chaque déploiement. Refusés, donc ;
 *  - en IPv6, l'adresse complète **tourne** chez la plupart des abonnés, tandis
 *    que le préfixe `/64` reste celui du raccordement. Bloquer l'adresse exacte
 *    serait inopérant au premier renouvellement ;
 *  - une IPv6 qui encapsule une IPv4 (`::ffff:192.0.2.1`) a un préfixe `/64`
 *    **entièrement nul**, partagé avec `::1` et avec toute autre adresse
 *    encapsulée. En déduire un `/64` bloquerait le monde entier. Ces adresses
 *    sont donc ramenées à l'IPv4 qu'elles portent, ou bloquées exactement.
 *
 * La valeur rendue est aussi celle qu'on **compare** à chaque visite : une
 * seule fonction pour poser et pour reconnaître, sinon les deux divergent.
 */
export function ipBlockKey(ip: string): string | null {
  const value = ip.trim().toLowerCase();
  if (value === '' || value === DEV_CLIENT_IP || value === UNKNOWN_CLIENT_IP) return null;

  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;

  // Une IPv4 encapsulée : `::ffff:192.0.2.1`, ou la forme ancienne `::192.0.2.1`.
  // C'est l'IPv4 qui identifie le client, et c'est elle qu'on bloque.
  const encapsulee = /^(?:0{0,4}:){0,5}:?(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
  if (encapsulee && isIP(encapsulee[1]!) === 4) return encapsulee[1]!;

  const groupes = expandIpv6(value);
  if (groupes === null) return null;

  // Un préfixe nul, c'est `::1`, `::` ou une forme encapsulée qui aurait
  // échappé au motif ci-dessus : aucun abonné derrière, donc pas de `/64`.
  const prefixe = groupes.slice(0, 4);
  if (prefixe.every((groupe) => groupe === 0)) {
    return groupes.map((groupe) => groupe.toString(16)).join(':');
  }

  return `${prefixe.map((groupe) => groupe.toString(16)).join(':')}::/64`;
}

/**
 * Un quad pointé final (`64:ff9b::192.0.2.1`) réécrit en deux groupes
 * hexadécimaux. Ces adresses existent — NAT64 en premier lieu, et c'est par là
 * que passent des abonnés mobiles entiers : sans cette réécriture, elles
 * n'auraient aucune clé de blocage, et le formulaire affirmerait à tort que
 * « l'adresse ne désigne personne ». La forme `::ffff:…` est traitée avant,
 * ailleurs : ici il ne reste que les préfixes non nuls.
 */
function reecrireQuadPointe(value: string): string {
  const quad = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
  if (quad === null) return value;
  const octets = quad[2]!.split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return value;
  const haut = ((octets[0]! << 8) | octets[1]!).toString(16);
  const bas = ((octets[2]! << 8) | octets[3]!).toString(16);
  return `${quad[1]}${haut}:${bas}`;
}

/**
 * Les huit groupes de 16 bits d'une IPv6, `::` développé. `null` si la forme
 * n'est pas celle qu'on sait lire — mieux vaut refuser un blocage que le poser
 * sur une clé fausse.
 *
 * L'adresse a déjà passé `isIP`, mais `isIP` accepte aussi une zone (`%eth0`)
 * et les formes encapsulées ; ce qui ne fait pas huit groupes hexadécimaux
 * après développement est écarté ici.
 */
function expandIpv6(value: string): readonly number[] | null {
  const sansZone = reecrireQuadPointe(value.split('%')[0]!);
  const moities = sansZone.split('::');
  if (moities.length > 2) return null;

  const lire = (part: string): number[] | null => {
    if (part === '') return [];
    const groupes: number[] = [];
    for (const morceau of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(morceau)) return null;
      groupes.push(Number.parseInt(morceau, 16));
    }
    return groupes;
  };

  const gauche = lire(moities[0]!);
  const droite = moities.length === 2 ? lire(moities[1]!) : [];
  if (gauche === null || droite === null) return null;

  if (moities.length === 1) return gauche.length === 8 ? gauche : null;
  const manquants = 8 - gauche.length - droite.length;
  if (manquants < 1) return null;
  return [...gauche, ...Array.from({length: manquants}, () => 0), ...droite];
}

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
