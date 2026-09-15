/**
 * Ce que la page **doit** afficher, calculé depuis la fixture.
 *
 * Les tests navigateur ne réécrivent aucun texte attendu : ils rejouent la même
 * projection que le serveur, sur le même fichier fictif que Playwright lui
 * passe en `CONTENT_DIR`. Une valeur codée en dur ici cesserait de prouver que
 * la page vient de la projection — elle prouverait seulement que deux copies
 * concordent.
 *
 * Le contenu réel n'entre jamais dans ces tests : `tests/fixtures/content/` est
 * fictif de bout en bout (AD-2).
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {buildProjections, type DisplayProjection} from '../../src/content/projections';
import {cvSchema, LANGS, type Lang} from '../../src/content/schema';

/**
 * `__dirname` et non `import.meta.url` : Playwright charge ses fichiers de test
 * en CommonJS, où `import.meta` est une erreur de syntaxe — même contrainte que
 * `playwright.config.ts`.
 */
export const FIXTURE_CV = resolve(__dirname, '../fixtures/content/cv.yaml');

/** Le document brut — utile aux sentinelles de `no-leak.spec.ts`. */
export const rawCv = parse(readFileSync(FIXTURE_CV, 'utf8')) as Record<string, unknown>;

const parsed = cvSchema.parse(rawCv);

/** La projection `display` de chaque langue, telle que la page la reçoit. */
export const display: Record<Lang, DisplayProjection> = Object.fromEntries(
  LANGS.map((lang) => [lang, buildProjections(parsed, lang, {hasPhoto: true}).display])
) as Record<Lang, DisplayProjection>;

export {LANGS};
export type {Lang};
