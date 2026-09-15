/**
 * Couche `content` — frontière.
 *
 * Responsabilité : charger et valider le contenu privé depuis `CONTENT_DIR`
 * (`cv.yaml`, `qa.fr.md`, `qa.en.md`, `assets/`), puis produire les deux
 * projections par liste blanche, `display` et `agent` (AD-2, AD-8).
 *
 * Dépendances autorisées : `src/env.ts`, `src/lib/`, la bibliothèque standard.
 * Interdites : `agent`, `journal`, `app` — cette couche est la plus basse et ne
 * connaît rien de ce qui la consomme. Elle est aussi la seule à lire `CONTENT_DIR`.
 *
 * **Surface publique.** Ce qui n'est pas exporté ici n'existe pas pour le reste
 * du site : ni le document `cv.yaml` brut, ni le chemin de la photo, ni le corps
 * d'une entrée `PRIVÉ`. Le chargement a lieu une fois, à la première demande —
 * `ensureContent()` la déclenche au démarrage pour que l'échec arrive là, et non
 * à la première visite.
 */
import {env} from '@/env';
import {loadContent, logContentWarnings, type Content, type ReferenceContact} from './load';
import {ageFrom, type AgentProjection, type DisplayProjection} from './projections';
import type {QaEntry, QaStatus} from './qa-parser';
import type {Lang} from './schema';

export {ContentError} from './load';
export type {ReferenceContact} from './load';
export {QA_STATUSES} from './qa-parser';
export {LANGS} from './schema';
export type {
  AgentProjection,
  DisplayProjection,
  ProjectedCertificat,
  ProjectedCompetence,
  ProjectedExperience,
  ProjectedFormation,
  ProjectedLangue
} from './projections';
export type {QaBlock, QaEntry, QaStatus} from './qa-parser';
export type {Lang} from './schema';

let loaded: Content | null = null;

function content(): Content {
  if (loaded === null) {
    const {content: fresh, warnings} = loadContent(env.CONTENT_DIR);
    logContentWarnings(warnings);
    loaded = fresh;
  }
  return loaded;
}

/**
 * Charge le contenu maintenant. Appelé au démarrage : un contenu invalide doit
 * arrêter le processus, pas décevoir le premier visiteur (AD-2).
 */
export function ensureContent(): void {
  content();
}

/**
 * L'âge est la seule valeur projetée qui dépende du jour : gelé au chargement
 * avec le reste, il resterait faux d'un anniversaire au prochain redémarrage.
 * Il est donc recalculé à chaque lecture, depuis la date que la projection
 * porte déjà. Si la date ne donne pas d'âge, celui du chargement — tout aussi
 * absent — reste tel quel.
 */
function withCurrentAge<T extends {readonly date_naissance: string; readonly age?: number}>(
  identite: T
): T {
  const age = ageFrom(identite.date_naissance, new Date());
  return age === undefined ? identite : {...identite, age};
}

/** La projection destinée à la page — jamais celle du modèle (AD-8). */
export function displayProjection(lang: Lang): DisplayProjection {
  const display = content().cv.display[lang];
  return {...display, identite: withCurrentAge(display.identite)};
}

/** La projection destinée au modèle — jamais celle de la page (AD-8). */
export function agentProjection(lang: Lang): AgentProjection {
  const agent = content().cv.agent[lang];
  return {...agent, identite: withCurrentAge(agent.identite)};
}

/** Le corpus question/réponse d'une langue, dans l'ordre du fichier (AD-5). */
export function corpus(lang: Lang): readonly QaEntry[] {
  return content().qa[lang];
}

/**
 * Une entrée par identifiant, dans une langue.
 *
 * L'index est construit **sans prototype** (`load.ts`) : les identifiants
 * viendront de clés de citation produites par le modèle, et sur un objet
 * ordinaire `qaEntry('fr', 'toString')` rendrait une fonction héritée que le
 * type déclare pourtant être une entrée.
 */
export function qaEntry(lang: Lang, id: string): QaEntry | undefined {
  return content().byId[lang][id];
}

/** Statut d'une entrée sans avoir à la lire — d'une `PRIVÉ`, on n'a que ceci. */
export function qaStatus(lang: Lang, id: string): QaStatus | undefined {
  return content().byId[lang][id]?.statut;
}

/** Une photo prête à être servie : des octets et un type, jamais un chemin. */
export type ServedPhoto = {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
  readonly etag: string;
};

/**
 * La photo, pour la route qui la sert (AD-8 : « servie depuis `CONTENT_DIR/assets` »).
 *
 * `displayProjection` n'annonce que sa **présence** ; son chemin ne sort pas
 * d'ici. L'appelant reçoit des octets, un type MIME et un `ETag` — rien qui
 * révèle l'arborescence du dépôt privé. Les octets sont ceux lus au démarrage
 * (AD-2) : aucun accès disque à la requête. `null` quand `cv.yaml` n'en déclare
 * pas, quand le fichier était introuvable ou illisible, ou quand son type n'est
 * pas reconnu.
 */
export function photo(): ServedPhoto | null {
  const file = content().restricted.photo;
  return file === null ? null : {bytes: file.bytes, mime: file.mime, etag: file.etag};
}

/**
 * Le numéro de téléphone — **la seule exception délibérée** aux projections.
 *
 * AD-8 l'exclut des deux projections : il ne doit jamais figurer dans le HTML
 * servi ni dans le contexte du modèle. Il reste pourtant une coordonnée que
 * Jérémie publie, à la demande. La route `/api/contact/phone` est donc le seul
 * appelant légitime de cette fonction ; tout autre usage remettrait le numéro
 * dans une page rendue côté serveur, ce qu'AD-8 interdit.
 */
export function contactPhone(): string | null {
  return content().restricted.telephone;
}

/**
 * Les coordonnées d'une référence — la seconde exception, de même nature que le
 * téléphone, et pour des données de tiers (AD-8, amendé le 2026-09-15). La
 * route `/api/references/<id>/contact` est son seul appelant légitime. `null`
 * pour un identifiant inconnu, ou une référence sans aucune coordonnée.
 */
export function referenceContact(id: string): ReferenceContact | null {
  const contact = Object.hasOwn(content().restricted.references, id)
    ? content().restricted.references[id]!
    : undefined;
  if (contact === undefined || (contact.telephone === null && contact.email === null)) return null;
  return contact;
}
