/**
 * Frontières de couches — filet de sécurité derrière la règle ESLint.
 *
 * Le graphe vient de `layers.config.mjs`, comme pour ESLint : une seule source.
 * Ce test attrape en plus ce qu'une règle d'import ne voit pas — les `import()`
 * dynamiques, y compris à littéral de gabarit — et refuse tout `import()` dont
 * l'argument n'est pas analysable statiquement. Il vérifie enfin qu'aucun
 * `middleware.ts` ne réapparaît : Next 16 le remplace par `proxy.ts`.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
// Module de configuration partagé, en JavaScript : `allowJs` en infère les types.
import {
  FORBIDDEN_LAYERS,
  FORBIDDEN_MODULES,
  LAYER_PATHS,
  SHARED,
  SOURCE_EXTENSIONS
} from '../../layers.config.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'scripts');
const extensions = SOURCE_EXTENSIONS as string[];

// L'outillage n'est pas dans `src/`, mais il tourne sur la même machine et
// pourrait ouvrir `usage.db` ou appeler le modèle. Il est donc contrôlé comme
// le reste : sans cela, un prochain script franchirait le graphe sans être vu.
const SCANNED = [SRC, SCRIPTS];

const forbiddenLayers = FORBIDDEN_LAYERS as Record<string, string[]>;
const forbiddenModules = FORBIDDEN_MODULES as Record<string, string[] | undefined>;
const layerPaths = LAYER_PATHS as Record<string, string[]>;
const shared = SHARED as string;

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (extensions.some((extension) => entry.endsWith(`.${extension}`))) {
      found.push(path);
    }
  }
  return found;
}

/** Le fichier appartient-il à ce chemin de couche ? Comparaison par segment. */
function belongsTo(file: string, layerPath: string): boolean {
  const absolute = join(ROOT, layerPath);
  // `src/apparat.ts` ne doit pas entrer dans la couche `src/app`.
  return file === absolute || file.startsWith(absolute + sep);
}

/** Couche d'un fichier, ou le code partagé s'il n'appartient à aucune. */
function layerOf(file: string): string {
  for (const [layer, paths] of Object.entries(layerPaths)) {
    if (paths.some((path) => belongsTo(file, path))) {
      return layer;
    }
  }
  return shared;
}

type Analysis = {specifiers: string[]; opaqueImports: number};

/**
 * Spécifieurs de `import ... from 'x'`, `export ... from 'x'`, `import 'x'`,
 * `require('x')`, `import('x')` et des littéraux de gabarit.
 * Compte séparément les `import()` dont l'argument n'est pas un littéral.
 */
function analyze(source: string): Analysis {
  const specifiers: string[] = [];
  const staticPatterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // import(`x/${y}/z`) — le gabarit entier, interpolations comprises.
    /\bimport\s*\(\s*`([^`]*)`\s*\)/g
  ];
  for (const pattern of staticPatterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]!);
    }
  }

  // Tout `import(` dont l'argument n'ouvre pas sur un littéral est opaque :
  // ni ESLint ni ce test ne peuvent dire quelle couche il atteint.
  const opaqueImports = [...source.matchAll(/\bimport\s*\(\s*(.)/g)].filter(
    (match) => !["'", '"', '`'].includes(match[1]!)
  ).length;

  return {specifiers, opaqueImports};
}

function crossesInto(specifier: string, layer: string): boolean {
  return new RegExp(`(^|/)${layer}(/|$)`).test(specifier);
}

describe('frontières de couches', () => {
  const files = SCANNED.flatMap(sourceFiles);

  it('trouve bien les sources à contrôler', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const scope of Object.keys(forbiddenLayers)) {
    const scopeFiles = files.filter((file) => layerOf(file) === scope);
    const label = scope === shared ? 'le code partagé' : `« ${scope} »`;

    it(`${label} n'importe aucune couche interdite`, () => {
      const violations: string[] = [];
      for (const file of scopeFiles) {
        const {specifiers} = analyze(readFileSync(file, 'utf8'));
        for (const specifier of specifiers) {
          for (const target of forbiddenLayers[scope]!) {
            if (crossesInto(specifier, target)) {
              violations.push(`${file.slice(ROOT.length)} → ${specifier}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });

    const modules = forbiddenModules[scope];
    if (modules) {
      it(`${label} n'importe aucun module interdit`, () => {
        const violations: string[] = [];
        for (const file of scopeFiles) {
          for (const specifier of analyze(readFileSync(file, 'utf8')).specifiers) {
            if (modules.includes(specifier)) {
              violations.push(`${file.slice(ROOT.length)} → ${specifier}`);
            }
          }
        }
        expect(violations).toEqual([]);
      });
    }
  }

  it("l'amorçage peut ouvrir le journal et construire l'index ; jamais atteindre l'agent", () => {
    // Le journal s'ouvre au démarrage, comme le contenu (AD-7), et l'index de
    // connaissance se construit là aussi (AD-3) : une entrée qui le casse doit
    // arrêter le processus au lancement. L'amorçage n'orchestre toujours rien :
    // `agent` — qui appelle le modèle — lui reste interdit.
    expect(forbiddenLayers.bootstrap).not.toContain('journal');
    expect(forbiddenLayers.bootstrap).not.toContain('content');
    expect(forbiddenLayers.bootstrap).not.toContain('knowledge');
    expect(forbiddenLayers.bootstrap).toEqual(expect.arrayContaining(['agent', 'app']));
    // Et le journal n'importe rien d'autre que ses propres types.
    expect(forbiddenLayers.journal).toEqual(
      expect.arrayContaining(['content', 'knowledge', 'agent', 'app'])
    );
  });

  it('le code partagé est bien soumis à une règle, et il en existe', () => {
    const sharedFiles = files.filter((file) => layerOf(file) === shared);
    expect(sharedFiles.length).toBeGreaterThan(0);
    expect(forbiddenLayers[shared]).toContain('agent');
  });

  it('aucun import dynamique opaque : tout `import()` est analysable', () => {
    const opaque = files.filter((file) => analyze(readFileSync(file, 'utf8')).opaqueImports > 0);
    expect(opaque.map((file) => file.slice(ROOT.length))).toEqual([]);
  });

  it('classe les fichiers par segment de chemin, pas par préfixe', () => {
    expect(layerOf(join(SRC, 'app', 'page.tsx'))).toBe('app');
    expect(layerOf(join(SRC, 'apparat.ts'))).toBe(shared);
    expect(layerOf(join(SRC, 'env.ts'))).toBe(shared);
    expect(layerOf(join(SRC, 'proxy.ts'))).toBe('app');
  });

  it("détecte un import de couche caché dans un littéral de gabarit", () => {
    const {specifiers} = analyze('const m = await import(`@/knowledge/${name}`);');
    expect(specifiers.some((specifier) => crossesInto(specifier, 'knowledge'))).toBe(true);
  });

  it('signale un import dynamique dont l’argument est une variable', () => {
    expect(analyze('const m = await import(chemin);').opaqueImports).toBe(1);
  });

  it("contrôle aussi l'outillage hors application", () => {
    const scanned = files.filter((file) => file.startsWith(SCRIPTS));
    expect(scanned.length).toBeGreaterThan(0);
    expect(layerOf(scanned[0]!)).toBe('scripts');
  });

  it('les cinq couches existent', () => {
    for (const layer of ['content', 'knowledge', 'agent', 'journal', 'app']) {
      expect(statSync(join(SRC, layer)).isDirectory()).toBe(true);
    }
  });

  it("n'utilise pas middleware.ts : Next 16 le remplace par proxy.ts", () => {
    for (const candidate of [join(ROOT, 'middleware.ts'), join(SRC, 'middleware.ts')]) {
      expect(() => statSync(candidate)).toThrow();
    }
    expect(statSync(join(SRC, 'proxy.ts')).isFile()).toBe(true);
  });
});
