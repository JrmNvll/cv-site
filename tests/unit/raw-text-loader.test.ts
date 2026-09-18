/**
 * Le chargeur de texte brut (`raw-text-loader.cjs`, story 9) : ce que
 * Turbopack — et webpack — obtiennent d'un fichier `.md` importé. Un module
 * ECMAScript dont l'export par défaut est le texte, tel quel — sans la marque
 * d'ordre des octets qu'un éditeur Windows peut poser en tête, et qui
 * deviendrait sinon le premier caractère du premier paragraphe.
 */
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const loader = require('../../raw-text-loader.cjs') as ((source: string | Buffer) => string) & {
  withoutBom(source: string | Buffer): string;
};

const BOM = String.fromCharCode(0xfeff);

/** Le texte que le module produit exporte : le littéral, relu en JSON. */
function exported(code: string): string {
  const match = /^export default ([\s\S]*);$/.exec(code);
  expect(match, 'un module « export default <littéral>; »').not.toBeNull();
  return JSON.parse(match![1]!) as string;
}

describe('raw-text-loader', () => {
  it('rend un module dont lʼexport par défaut est le texte, tel quel', () => {
    const texte = 'Premier paragraphe.\n\n## Titre\n\n- un\n- deux\n';
    expect(exported(loader(texte))).toBe(texte);
  });

  it('retire une marque dʼordre des octets en tête, et seulement là', () => {
    expect(exported(loader(`${BOM}Texte.`))).toBe('Texte.');
    expect(loader.withoutBom(`${BOM}Texte.`)).toBe('Texte.');
    expect(loader.withoutBom('Texte.')).toBe('Texte.');
    // Une seule est retirée ; une marque au milieu est un caractère comme un autre.
    expect(loader.withoutBom(`${BOM}${BOM}x`)).toBe(`${BOM}x`);
    expect(loader.withoutBom(`a${BOM}b`)).toBe(`a${BOM}b`);
    expect(loader.withoutBom('')).toBe('');
  });

  it('accepte un tampon dʼoctets comme une chaîne', () => {
    const texte = `${BOM}Accentué : é, «, ».`;
    expect(exported(loader(Buffer.from(texte, 'utf8')))).toBe('Accentué : é, «, ».');
  });

  it('échappe ce qui fermerait le littéral : guillemets, barres, retours à la ligne, U+2028', () => {
    const texte = `"quote" \\ back \n ligne ${String.fromCharCode(0x2028)} fin`;
    const code = loader(texte);
    expect(code.split('\n')).toHaveLength(1);
    expect(exported(code)).toBe(texte);
  });
});
