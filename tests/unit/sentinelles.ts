/**
 * Les sentinelles d'AD-8 — ce qui ne doit **jamais** sortir : ni d'une
 * projection (`projection-leak.test.ts`), ni du noyau que le modèle reçoit
 * (`knowledge.test.ts`), ni d'un contexte assemblé (`context.test.ts`).
 *
 * Les chemins ci-dessous sont la colonne « non / non » d'AD-8, plus les
 * chemins de fichiers. Les valeurs sont lues dans la fixture : rien n'est
 * comparé à une liste écrite à la main, changer la fixture change ce qui est
 * cherché. Un seul module pour trois tests, sinon trois listes divergent.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

export const FIXTURE_CV = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));

/** Le document brut de la fixture. */
export const rawCv = parse(readFileSync(FIXTURE_CV, 'utf8')) as Record<string, unknown>;

/**
 * Colonne « non / non » d'AD-8, plus les chemins de fichiers. `[]` traverse un
 * tableau ; un chemin sans suffixe emporte tout son sous-arbre.
 */
export const HORS_LISTE_BLANCHE = [
  'meta',
  'identite.prenoms_etat_civil',
  'identite.lieu_naissance',
  'identite.photo',
  'contact.telephone',
  'contact.adresse',
  // Nom et fonction d'une référence s'affichent (AD-8, amendé le 2026-09-15) ;
  // ses coordonnées, elles, ne sortent que par une route.
  'references[].telephone',
  'references[].email',
  'certificats_travail[].signataire',
  'certificats_travail[].fichier',
  'formation[].justificatif',
  'lettre_motivation.fichier',
  'lettre_motivation.type'
] as const;

/** Toutes les chaînes d'un sous-arbre, quelle que soit sa profondeur. */
export function strings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') found.push(node);
  else if (typeof node === 'number') found.push(String(node));
  else if (Array.isArray(node)) node.forEach((item) => strings(item, found));
  else if (node !== null && typeof node === 'object') {
    Object.values(node).forEach((item) => strings(item, found));
  }
  return found;
}

/** Suit un chemin, en dépliant les tableaux marqués `[]`. */
export function at(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const step of path.split('.')) {
    const key = step.replace('[]', '');
    const spread = step.endsWith('[]');
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== 'object') continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (spread && Array.isArray(value)) next.push(...value);
      else next.push(value);
    }
    current = next;
  }
  return current;
}

/**
 * Le seuil est haut — huit caractères — et c'est délibéré : une sentinelle
 * courte (`fr`, `0000`) finirait par apparaître dans une valeur projetée en
 * toute innocence, et ferait échouer pour rien le test dont tout dépend. La
 * fixture donne donc à chaque champ hors liste blanche une valeur longue et
 * unique, et `SENTINELLE_MIN` refuse de chercher ce qui ne prouverait rien.
 */
export const SENTINELLE_MIN = 8;

/** Valeurs à ne jamais retrouver. */
export const sentinelles: readonly string[] = [
  ...new Set(
    HORS_LISTE_BLANCHE.flatMap((path) => at(rawCv, path).flatMap((node) => strings(node))).filter(
      (value) => value.length >= SENTINELLE_MIN
    )
  )
];
