/**
 * `docs/decisions.md` (story 9) — la lecture publique des décisions
 * d'architecture que le code cite par leur numéro. Deux choses à tenir :
 * les dix-sept décisions y sont, chacune ouverte une fois, dans l'ordre ; et
 * tout `AD-n` cité dans `src/` ou `tests/` existe dans le fichier — un
 * commentaire ne doit pas désigner une décision que le lecteur ne peut pas
 * résoudre.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const decisions = readFileSync(join(ROOT, 'docs', 'decisions.md'), 'utf8');

/** Les numéros ouverts par une puce `- **AD-n — …**`, dans l'ordre du fichier. */
const ouvertes = [...decisions.matchAll(/^- \*\*AD-(\d+) — /gm)].map((match) => Number(match[1]));

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'fixtures') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(tsx?|mjs|cjs|md)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('docs/decisions.md', () => {
  it('ouvre les dix-sept décisions, une fois chacune, dans lʼordre', () => {
    expect(ouvertes).toEqual(Array.from({length: 17}, (_, index) => index + 1));
    // Chaque puce porte un titre en gras puis une règle — jamais un titre seul ;
    // une puce court jusqu'à la suivante, le titre peut se replier sur deux lignes.
    const puces = decisions.split(/^(?=- \*\*AD-)/m).filter((bloc) => bloc.startsWith('- **AD-'));
    expect(puces).toHaveLength(17);
    for (const puce of puces) {
      expect(puce).toMatch(/^- \*\*AD-\d+ — [^*]+\*\* \S[\s\S]+/);
    }
  });

  it('résout toute décision citée dans src/ et tests/', () => {
    const citees = new Map<number, string[]>();
    for (const path of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'tests'))]) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\bAD-(\d+)\b/g)) {
        const numero = Number(match[1]);
        citees.set(numero, [...(citees.get(numero) ?? []), relative(ROOT, path).split(sep).join('/')]);
      }
    }
    // Le code cite bien des décisions — sinon ce test ne prouve rien.
    expect(citees.size).toBeGreaterThanOrEqual(10);
    const inconnues = [...citees.entries()].filter(([numero]) => !ouvertes.includes(numero));
    expect(inconnues).toEqual([]);
  });

  it('ne porte ni nom, ni coordonnée', () => {
    expect(decisions).not.toMatch(/Jérémie|Nouvelle|Camille|Durand/);
    expect(decisions).not.toMatch(/@|\+41|mailto:|tel:/);
  });
});
