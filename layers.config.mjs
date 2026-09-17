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
 *   bootstrap ──▶ content     (hors graphe : voir `LAYER_PATHS.bootstrap`)
 *       ├─────▶ knowledge
 *       └─────▶ journal
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
  app: ['src/app', 'src/proxy.ts'],
  /**
   * L'amorçage du processus. Il n'est pas *dans* le graphe, il est **au-dessus** :
   * quelque chose doit valider la configuration, charger le contenu, construire
   * l'index de connaissance et ouvrir le journal avant la première requête, et
   * arrêter le processus si l'un des quatre ne va pas (AD-2, AD-3, AD-7, AD-9).
   * Ce quelque chose ne peut appartenir à aucune couche — `content`, `knowledge`
   * et `journal` sont trop bas pour se déclencher eux-mêmes, `app` arrive trop
   * tard. Deux fichiers nommés, et il faut un motif d'amorçage pour en ajouter un
   * troisième.
   */
  bootstrap: ['src/instrumentation.ts', 'src/lib/startup.ts'],
  /**
   * Outillage hors application (`npm run check:content`). Il tourne hors de
   * Next, sans configuration d'application, et n'atteint que la couche la plus
   * basse : un script qui ouvrirait `usage.db` ou appellerait le modèle
   * contournerait tout ce que ce graphe protège, sans que rien ne le voie.
   */
  scripts: ['scripts']
};

/**
 * Nom conventionnel du reste de `src/` : `env.ts`, `lib/`, `i18n/`. Ce code est
 * appelé par toutes les couches, donc il n'en connaît aucune — sinon il devient
 * le passage dérobé du graphe.
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
  // L'amorçage ne touche que ce qui doit être prêt avant la première requête :
  // il valide, charge, construit et ouvre, il n'orchestre rien. `journal` parce
  // que la base s'ouvre au démarrage comme le contenu (AD-7) ; `knowledge` parce
  // qu'une entrée qui casse l'index doit arrêter le processus au lancement, pas
  // à la première question d'un recruteur (AD-3). `agent`, lui, reste hors de
  // portée : il n'a rien à préparer, et c'est lui qui appelle le modèle.
  bootstrap: ['agent', 'app'],
  // L'outillage lit le contenu, et rien d'autre.
  scripts: ['knowledge', 'agent', 'journal', 'app'],
  // Fermé par défaut : le code partagé ne dépend d'aucune couche.
  [SHARED]: ['content', 'knowledge', 'agent', 'journal', 'app']
};

/** Modules externes interdits, par couche. */
export const FORBIDDEN_MODULES = {
  // `agent` ne lit jamais HTTP : lang, visitorId, sessionId, ip et l'entrée lui
  // sont passés en paramètres.
  agent: ['next/headers', 'next/server', 'next/navigation'],
  // L'amorçage tourne avant la première requête : il n'y a rien à y lire.
  bootstrap: ['next/headers'],
  // L'outillage tourne hors de Next : il n'y a pas de requête du tout.
  scripts: ['next/headers'],
  // Le code partagé ne lit pas la requête non plus : seul `app` la connaît.
  [SHARED]: ['next/headers']
};

/** Extensions contrôlées : l'outillage est en `.mjs`, le reste en TypeScript. */
export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js'];

/** Globs ESLint des fichiers d'une couche. */
export function layerFileGlobs(layer) {
  return LAYER_PATHS[layer].map((path) =>
    /\.[cm]?[jt]sx?$/.test(path) ? path : `${path}/**/*.{${SOURCE_EXTENSIONS.join(',')}}`
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
