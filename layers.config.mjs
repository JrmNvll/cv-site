/**
 * Graphe de dépendances des couches — **source unique**.
 *
 * Le squelette d'architecture pose que les dépendances pointent vers
 * l'intérieur : une couche ne connaît que celles qui sont sous elle, et une
 * flèche absente du graphe est interdite.
 *
 *   app ──▶ agent ──▶ knowledge ──▶ content
 *    │        └─────▶ journal
 *    ├──────▶ journal
 *    └──────▶ content
 *
 * Ce module est consommé par `eslint.config.mjs` (qui fait échouer le lint) et
 * par `tests/unit/layers.test.ts` (qui attrape en plus les `import()`
 * dynamiques). Ne décrire le graphe nulle part ailleurs : le README renvoie ici.
 */

/** Les cinq couches, et les chemins qui leur appartiennent (relatifs à la racine). */
export const LAYER_PATHS = {
  content: ['src/content'],
  knowledge: ['src/knowledge'],
  agent: ['src/agent'],
  journal: ['src/journal'],
  app: ['src/app', 'src/proxy.ts']
};

/**
 * Nom conventionnel du reste de `src/` : `env.ts`, `lib/`, `i18n/`,
 * `instrumentation.ts`. Ce code est appelé par toutes les couches, donc il
 * n'en connaît aucune — sinon il devient le passage dérobé du graphe.
 */
export const SHARED = 'shared';

/** Ce que chaque couche — et le code partagé — ne peut pas importer. */
export const FORBIDDEN_LAYERS = {
  // `app` orchestre : elle appelle `agent` et `journal`, elle n'assemble jamais
  // un contexte elle-même.
  app: ['knowledge'],
  agent: ['app'],
  knowledge: ['agent', 'journal', 'app'],
  content: ['agent', 'journal', 'app'],
  // `journal` n'importe rien d'autre que ses propres types.
  journal: ['content', 'knowledge', 'agent', 'app'],
  // Fermé par défaut : le code partagé ne dépend d'aucune couche.
  [SHARED]: ['content', 'knowledge', 'agent', 'journal', 'app']
};

/** Modules externes interdits, par couche. */
export const FORBIDDEN_MODULES = {
  // `agent` ne lit jamais HTTP : lang, visitorId, sessionId, ip et l'entrée lui
  // sont passés en paramètres.
  agent: ['next/headers', 'next/server', 'next/navigation'],
  // Le code partagé ne lit pas la requête non plus : seul `app` la connaît.
  [SHARED]: ['next/headers']
};

/** Globs ESLint des fichiers d'une couche. */
export function layerFileGlobs(layer) {
  return LAYER_PATHS[layer].map((path) =>
    path.endsWith('.ts') ? path : `${path}/**/*.{ts,tsx}`
  );
}

/** Globs ESLint de tout ce qui appartient à une couche — donc à exclure du partagé. */
export function allLayerFileGlobs() {
  return Object.keys(LAYER_PATHS).flatMap(layerFileGlobs);
}

/** Tous les chemins par lesquels une couche peut être atteinte, alias ou relatif. */
export function layerImportPatterns(layer) {
  return [`@/${layer}`, `@/${layer}/**`, `**/${layer}`, `**/${layer}/**`];
}
