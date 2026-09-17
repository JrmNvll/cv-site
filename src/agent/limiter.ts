/**
 * Le limiteur de débit — AD-6 : trois fenêtres glissantes, en mémoire,
 * chacune bloquante, consommées ensemble ou pas du tout.
 *
 *  - 10 questions par 15 minutes par visiteur (`cv_visitor`) ;
 *  - 10 questions par 15 minutes par adresse (`X-Client-IP`, ou `dev`) ;
 *  - 60 questions par heure pour le site entier.
 *
 * **Tout ou rien.** Une question qui passe consomme une place dans les trois
 * fenêtres ; une question refusée n'en consomme aucune — sinon un visiteur
 * bloqué par la fenêtre du site continuerait d'épuiser la sienne, et un
 * refus en entraînerait d'autres.
 *
 * **L'état est perdu au redémarrage**, et c'est dit (README) : c'est le
 * plafond persistant du journal qui protège l'argent, pas ceci. Ceci protège
 * contre la rafale — un script, un visiteur qui martèle — entre deux
 * redémarrages. Il vit sur `globalThis`, par la même porte que le journal :
 * Turbopack construit plusieurs graphes de modules pour le serveur, et un
 * compteur par graphe ne compterait rien.
 *
 * Aucune lecture de HTTP ici : visiteur, adresse et instant sont **passés**.
 * Une adresse **inconnue** — en production sans `X-Client-IP`, `clientIp()`
 * rend `unknown` pour tout le monde — ne donne pas lieu à une fenêtre
 * d'adresse : sinon une seule fenêtre de dix questions servirait le site
 * entier. Visiteur et site protègent seuls ; `clientIp()` a déjà averti.
 */
import {UNKNOWN_CLIENT_IP} from '@/lib/client-ip';

/** Les trois fenêtres — changer un seuil est une décision à demander. */
export const LIMITS = {
  visitor: {max: 10, windowMs: 15 * 60_000},
  ip: {max: 10, windowMs: 15 * 60_000},
  site: {max: 60, windowMs: 60 * 60_000}
} as const;

export type TakeInput = {
  readonly visitorId: string;
  readonly ip: string;
  /** L'instant de la question ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/** Par clé, les instants (ms) des questions passées, du plus ancien au plus récent. */
type Windows = {
  readonly visitors: Map<string, number[]>;
  readonly ips: Map<string, number[]>;
  site: number[];
};

const HOLDER = Symbol.for('cv-site.agent.limiter');
const holder: Windows = ((globalThis as unknown as Record<symbol, Windows | undefined>)[HOLDER] ??= {
  visitors: new Map(),
  ips: new Map(),
  site: []
});

/**
 * Au-delà de tant de clés, chaque question balaie toutes les fenêtres pour
 * oublier celles qui sont vides : un visiteur ne revient pas forcément, et
 * une clé par cookie forgé grandirait sans fin.
 */
const SWEEP_ABOVE = 1024;

/**
 * Retire de la fenêtre ce qui est plus vieux que sa durée ; rend ce qui
 * reste. La fenêtre est triée : les instants poussés sont monotones (voir
 * `stamp`), donc s'arrêter au premier instant récent suffit.
 */
function prune(stamps: number[], windowMs: number, now: number): number[] {
  const floor = now - windowMs;
  let keep = 0;
  while (keep < stamps.length && stamps[keep]! <= floor) keep += 1;
  if (keep > 0) stamps.splice(0, keep);
  return stamps;
}

function sweep(map: Map<string, number[]>, windowMs: number, now: number): void {
  if (map.size <= SWEEP_ABOVE) return;
  for (const [key, stamps] of map) {
    if (prune(stamps, windowMs, now).length === 0) map.delete(key);
  }
}

function windowOf(map: Map<string, number[]>, key: string): number[] {
  let stamps = map.get(key);
  if (stamps === undefined) {
    stamps = [];
    map.set(key, stamps);
  }
  return stamps;
}

/**
 * Prend une place dans les trois fenêtres, ou dans aucune. `true` : la
 * question peut partir ; `false` : refusée, rien n'a été consommé.
 */
export function take(input: TakeInput): boolean {
  const now = (input.now ?? new Date()).getTime();
  if (Number.isNaN(now)) throw new TypeError('take : now doit être une date valide');

  sweep(holder.visitors, LIMITS.visitor.windowMs, now);
  sweep(holder.ips, LIMITS.ip.windowMs, now);

  const visitor = prune(windowOf(holder.visitors, input.visitorId), LIMITS.visitor.windowMs, now);
  const known = input.ip !== UNKNOWN_CLIENT_IP;
  const ip = known ? prune(windowOf(holder.ips, input.ip), LIMITS.ip.windowMs, now) : null;
  const site = prune(holder.site, LIMITS.site.windowMs, now);

  if (
    visitor.length >= LIMITS.visitor.max ||
    (ip !== null && ip.length >= LIMITS.ip.max) ||
    site.length >= LIMITS.site.max
  ) {
    // Une clé vide créée pour rien ne reste pas : la carte ne grandit pas sur un refus.
    if (visitor.length === 0) holder.visitors.delete(input.visitorId);
    if (ip !== null && ip.length === 0) holder.ips.delete(input.ip);
    return false;
  }

  // Jamais en arrière : une horloge reculée — réglage, saut du système — ne
  // doit pas glisser un instant plus ancien après un plus récent, sinon
  // `prune` s'arrêterait dessus et la fenêtre ne se viderait plus.
  const stamp = (stamps: number[]) => Math.max(now, stamps.at(-1) ?? now);
  visitor.push(stamp(visitor));
  if (ip !== null) ip.push(stamp(ip));
  site.push(stamp(site));
  return true;
}

/** Remet les trois fenêtres à zéro — pour les tests. Un redémarrage fait pareil. */
export function resetLimiter(): void {
  holder.visitors.clear();
  holder.ips.clear();
  holder.site.length = 0;
}

/** Combien de clés chaque carte retient — pour les tests du balayage. */
export function limiterSizes(): {readonly visitors: number; readonly ips: number; readonly site: number} {
  return {visitors: holder.visitors.size, ips: holder.ips.size, site: holder.site.length};
}
