/**
 * Un fichier `.md` importé est sa chaîne, telle quelle.
 *
 * Les deux pages de prose (story 9) importent leur texte par un import
 * statique ; la règle `*.md` de `next.config.ts` passe le fichier par
 * `raw-text-loader.cjs` (à la racine), et Turbopack inline son contenu dans le
 * bundle — il survit au build autonome, rien n'est lu sur le disque à la
 * requête. Cette déclaration dit à TypeScript ce que le chargeur rend.
 */
declare module '*.md' {
  const text: string;
  export default text;
}
