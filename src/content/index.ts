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
import {loadContent, logContentWarnings, type Content} from './load';
import type {AgentProjection, DisplayProjection} from './projections';
import type {QaEntry, QaStatus} from './qa-parser';
import type {Lang} from './schema';

export {ContentError} from './load';
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

/** La projection destinée à la page — jamais celle du modèle (AD-8). */
export function displayProjection(lang: Lang): DisplayProjection {
  return content().cv.display[lang];
}

/** La projection destinée au modèle — jamais celle de la page (AD-8). */
export function agentProjection(lang: Lang): AgentProjection {
  return content().cv.agent[lang];
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
