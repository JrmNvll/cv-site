/**
 * Chargeur de texte brut (API webpack, exécuté par Turbopack) : un fichier
 * importé devient un module qui exporte son texte, tel quel, en export par
 * défaut — `import texte from './page.fr.md'`. Branché sur `*.md` du projet
 * par `next.config.ts` (story 9 : les textes des deux pages de prose) ; la
 * déclaration TypeScript est `src/types/markdown.d.ts`. Douze lignes plutôt
 * qu'une dépendance : le type intégré `raw` de Turbopack 16.3 rend un module
 * sans export.
 *
 * Une marque d'ordre des octets (BOM UTF-8) en tête de fichier est retirée :
 * un éditeur Windows peut en poser une, et elle deviendrait le premier
 * caractère du premier paragraphe. À la racine, avec les autres fichiers de
 * configuration : ce n'est ni du code de l'application ni de l'outillage de
 * maintenance (`scripts/`).
 */
'use strict';

const BOM = 0xfeff;

/** Le texte d'un fichier, sans sa marque d'ordre des octets éventuelle. */
function withoutBom(source) {
  const text = String(source);
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

module.exports = function rawTextLoader(source) {
  return `export default ${JSON.stringify(withoutBom(source))};`;
};

module.exports.withoutBom = withoutBom;
