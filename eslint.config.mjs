import {defineConfig, globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import {
  FORBIDDEN_LAYERS,
  FORBIDDEN_MODULES,
  SHARED,
  allLayerFileGlobs,
  layerFileGlobs,
  layerImportPatterns
} from './layers.config.mjs';

/**
 * Frontières de couches — le graphe vit dans `layers.config.mjs`, ici on ne fait
 * que le traduire en règles ESLint. `tests/unit/layers.test.ts` lit le même
 * module et couvre en plus les `import()` dynamiques.
 */
function restrictedImports(scope) {
  const groups = [];

  for (const target of FORBIDDEN_LAYERS[scope] ?? []) {
    groups.push({
      group: layerImportPatterns(target),
      message: `Frontière de couches : « ${scope} » n'importe jamais « ${target} » (voir layers.config.mjs).`
    });
  }

  const modules = FORBIDDEN_MODULES[scope];
  if (modules) {
    groups.push({
      group: modules,
      message: `Frontière de couches : « ${scope} » ne lit jamais HTTP — les en-têtes, cookies et paramètres lui sont passés par « app » (voir layers.config.mjs).`
    });
  }

  return {'no-restricted-imports': ['error', {patterns: groups}]};
}

const layerBoundaries = [
  ...Object.keys(FORBIDDEN_LAYERS)
    .filter((scope) => scope !== SHARED)
    .map((layer) => ({
      files: layerFileGlobs(layer),
      rules: restrictedImports(layer)
    })),
  // Fermé par défaut : tout ce qui, dans `src/`, n'appartient à aucune couche.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: allLayerFileGlobs(),
    rules: restrictedImports(SHARED)
  }
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...layerBoundaries,
  globalIgnores([
    // Ignorés par défaut par eslint-config-next :
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Propres au dépôt :
    'node_modules/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**'
  ])
]);

export default eslintConfig;
