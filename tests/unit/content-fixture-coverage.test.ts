/**
 * AD-2 — la fixture doit couvrir **tout** le schéma.
 *
 * Un champ déclaré au schéma mais absent de la fixture n'est testé nulle part :
 * ni sa reconnaissance (`content-schema`), ni sa résolution bilingue
 * (`content-projections`), ni sa non-fuite (`projection-leak`, qui ne cherche
 * que des valeurs présentes dans la fixture). Il existerait dans le fichier réel
 * sans qu'aucun test n'ait jamais eu son mot à dire.
 *
 * Ce contrôle parcourt le schéma Zod lui-même — pas une liste écrite à la main —
 * et exige une valeur pour chaque champ, obligatoire comme optionnel.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {cvSchema} from '@/content/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));
const raw = parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;

/** Le minimum du schéma Zod dont ce parcours a besoin. */
type SchemaNode = {
  def: {type: string};
  shape?: Record<string, SchemaNode>;
  element?: SchemaNode;
  options?: SchemaNode[];
  unwrap?: () => SchemaNode;
};

/**
 * Tous les chemins de champs du schéma. `[]` marque la traversée d'un tableau.
 * Une union est suivie dans chacune de ses branches objet : `{fr, en}` compte.
 */
function fieldPaths(node: SchemaNode, prefix = '', found = new Set<string>()): Set<string> {
  const kind = node.def.type;

  if (kind === 'optional' || kind === 'nullable' || kind === 'default') {
    return fieldPaths(node.unwrap!(), prefix, found);
  }
  if (kind === 'array') {
    return fieldPaths(node.element!, `${prefix}[]`, found);
  }
  if (kind === 'union') {
    for (const option of node.options!) fieldPaths(option, prefix, found);
    return found;
  }
  if (kind === 'object' && node.shape) {
    for (const [key, child] of Object.entries(node.shape)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      found.add(path);
      fieldPaths(child, path, found);
    }
  }
  return found;
}

/** Suit un chemin dans le YAML brut, en dépliant les tableaux marqués `[]`. */
function valuesAt(root: unknown, path: string): unknown[] {
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
 * Champs des branches `{fr, en}` : la fixture les couvre par les champs
 * bilingues eux-mêmes, il serait absurde d'exiger un `profil.fr` **et** un
 * `profil` en chaîne dans le même fichier.
 */
const BRANCHES_ALTERNATIVES = /\.(fr|en)$/;

const chemins = [...fieldPaths(cvSchema as unknown as SchemaNode)]
  .filter((path) => !BRANCHES_ALTERNATIVES.test(path))
  .sort();

describe('la fixture couvre le schéma', () => {
  it('trouve bien des champs à couvrir — sinon le parcours est cassé', () => {
    expect(chemins.length).toBeGreaterThan(30);
    expect(chemins).toContain('identite.prenoms_etat_civil');
    expect(chemins).toContain('certificats_travail[].signataire');
    expect(chemins).toContain('experiences[].realisations');
  });

  it('donne une valeur à chaque champ du schéma, optionnel compris', () => {
    const absents = chemins.filter((path) => valuesAt(raw, path).length === 0);
    expect(absents).toEqual([]);
  });
});
