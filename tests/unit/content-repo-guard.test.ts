/**
 * AD-2 — le contenu réel n'entre jamais dans ce dépôt.
 *
 * `.gitignore` rattrape le `content/` copié à la racine, mais il ne dit rien
 * d'un `cv.yaml` déposé ailleurs, ni d'un `qa.fr.md` glissé dans `docs/` « pour
 * illustrer ». Ce contrôle ferme la porte par la forme du nom : les fichiers qui
 * portent la forme du contenu privé n'existent que dans les fixtures.
 *
 * La règle est volontairement mécanique. Elle ne juge pas si un fichier contient
 * des données réelles — c'est invérifiable — elle refuse l'emplacement.
 */
import {readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES = join('tests', 'fixtures');

/** Répertoires sans intérêt : dépendances, artefacts, historique. */
const IGNORED = new Set([
  'node_modules',
  '.next',
  '.git',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report'
]);

/**
 * `content/` **à la racine** seulement : déjà exclu par .gitignore, donc
 * incommitable, et vérifié comme tel plus bas. `tests/fixtures/content/`, lui,
 * est précisément ce que ce contrôle doit voir.
 */
const IGNORED_AT_ROOT = new Set(['content']);

/** La forme d'un fichier de contenu privé : `*.yaml`, `*.yml`, `qa.*.md`. */
function looksLikeContent(name: string): boolean {
  return /\.ya?ml$/i.test(name) || /^qa\..*\.md$/i.test(name);
}

function walk(directory: string, found: string[] = [], depth = 0): string[] {
  for (const entry of readdirSync(directory)) {
    if (IGNORED.has(entry)) continue;
    if (depth === 0 && IGNORED_AT_ROOT.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found, depth + 1);
    else found.push(path);
  }
  return found;
}

const files = walk(ROOT).map((path) => relative(ROOT, path));

describe('le dépôt ne porte aucun contenu réel', () => {
  it('parcourt bien le dépôt — sinon il ne prouve rien', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(join('tests', 'fixtures', 'content', 'cv.yaml'));
  });

  it("n'a ni cv.yaml ni qa.*.md en dehors des fixtures", () => {
    const suspects = files.filter(
      (path) => looksLikeContent(path.split(sep).at(-1)!) && !path.startsWith(FIXTURES + sep)
    );
    expect(suspects).toEqual([]);
  });

  it('ignore le répertoire content/ à la racine', async () => {
    const {readFileSync} = await import('node:fs');
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\/content\/$/m);
  });
});
