/**
 * La page ne dit que ce que la projection lui donne — **le test qui compte pour
 * la story 3**.
 *
 * Deux dangers, deux moitiés :
 *
 *  1. **Un texte de CV recopié dans un composant.** Il survivrait à une
 *     correction de `cv.yaml`, contredirait la page sans que rien ne l'annonce,
 *     et remettrait dans le dépôt public ce qu'AD-2 en a sorti. La première
 *     moitié lit les sources de la page et y cherche, une à une, **les valeurs
 *     réelles de la fixture** : rien n'est comparé à une liste écrite à la main.
 *  2. **Un champ optionnel absent rendu quand même.** La projection est
 *     parsemée d'optionnels (`activite`, `entreprise`, `fin`, `permis`…) ;
 *     assembler « entreprise · lieu » sans précaution produit « Société · » à la
 *     première valeur manquante. La seconde moitié éprouve les assembleurs de
 *     `format.ts` sur le cas absent, qui est le cas normal.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';
import {
  careerYears,
  monthYearLabel,
  employerCount,
  joinParts,
  periodLabel,
  yearOf
} from '@/app/[locale]/_components/format';
import {buildProjections} from '@/content/projections';
import {cvSchema, LANGS} from '@/content/schema';

const PAGE_DIR = fileURLToPath(new URL('../../src/app/[locale]', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/content/cv.yaml', import.meta.url));

const cv = cvSchema.parse(parse(readFileSync(FIXTURE, 'utf8')));
const NOW = new Date('2026-09-15T12:00:00Z');
const display = Object.fromEntries(
  LANGS.map((lang) => [lang, buildProjections(cv, lang, {hasPhoto: true, now: NOW}).display])
);

/** Toutes les sources de la page, y compris ses composants. */
function pageSources(): {path: string; source: string}[] {
  const found: {path: string; source: string}[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) {
        found.push({
          // Séparateurs normalisés : le test doit dire la même chose sous
          // Windows et sous Linux.
          path: relative(PAGE_DIR, path).split(sep).join('/'),
          source: readFileSync(path, 'utf8')
        });
      }
    }
  };
  walk(PAGE_DIR);
  return found;
}

const sources = pageSources();

/** Toutes les chaînes d'un sous-arbre de la projection, quelle que soit sa profondeur. */
function strings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') found.push(node);
  else if (Array.isArray(node)) node.forEach((item) => strings(item, found));
  else if (node !== null && typeof node === 'object') {
    Object.values(node).forEach((item) => strings(item, found));
  }
  return found;
}

/**
 * Seuil identique à celui de `projection-leak.test.ts`, et pour la même raison :
 * une valeur courte de la fixture (« Méthodes », « fr ») finirait par
 * apparaître dans un nom de classe ou une clé, et ferait échouer pour rien le
 * test dont tout dépend.
 */
const LONGUEUR_MIN = 8;
const valeursDeCv = [
  ...new Set(
    LANGS.flatMap((lang) => strings(display[lang])).filter(
      (value) => value.trim().length >= LONGUEUR_MIN
    )
  )
];

describe('aucun texte de CV nʼest écrit dans un composant', () => {
  it('a bien des valeurs à chercher, et des sources où chercher', () => {
    expect(valeursDeCv.length).toBeGreaterThanOrEqual(20);
    expect(sources.length).toBeGreaterThanOrEqual(6);
    expect(sources.map((file) => file.path)).toContain('page.tsx');
  });

  it.each(LANGS)('ne recopie aucune valeur projetée (%s)', (lang) => {
    const recherche = [
      ...new Set(strings(display[lang]).filter((value) => value.trim().length >= LONGUEUR_MIN))
    ];
    const fautes = sources.flatMap((file) =>
      recherche.filter((value) => file.source.includes(value)).map((value) => `${file.path} : ${value}`)
    );
    expect(fautes).toEqual([]);
  });

  it('cherche bien ce quʼil dit chercher', () => {
    // Sonde : si la recherche était inopérante, ce test-ci passerait aussi.
    expect(valeursDeCv).toContain('Développement assisté par IA — Développeuse logiciel & web');
    expect(valeursDeCv.some((value) => value.includes('Société Fictive SA'))).toBe(true);
  });

  it('nʼatteint le contenu que par la projection dʼaffichage', () => {
    // `from '...'` (import statique ou type-only) et `import('...')` (différé) :
    // les deux formes atteignent une couche, les deux doivent être vues.
    const imports = sources.flatMap((file) =>
      // Les deux guillemets : le formatage ne garantit pas les simples, et un
      // import à guillemets doubles ne doit pas passer sous ce radar.
      [...file.source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((match) => ({
        path: file.path,
        specifier: match[1]!
      }))
    );

    // Seule `page.tsx` atteint la couche `content` à l'exécution ; les autres
    // n'en tirent qu'un type. Et elle n'en tire que `displayProjection` : ni
    // `agentProjection`, ni `corpus`, ni `contactPhone`, ni `photo()` n'ont
    // quoi que ce soit à faire dans un rendu de page (AD-8).
    const versContent = imports.filter((entry) => entry.specifier.includes('@/content'));
    expect(versContent.map((entry) => entry.path).sort()).toEqual(
      [
        'page.tsx',
        '_components/career-section.tsx',
        '_components/education-section.tsx',
        '_components/identity-heading.tsx',
        '_components/identity-profile.tsx',
        '_components/references-section.tsx',
        '_components/site-header.tsx',
        '_components/skills-section.tsx'
      ].sort()
    );

    const page = sources.find((file) => file.path === 'page.tsx')!.source;
    // Import différé, et non statique : `@/content` entraîne `@/env`, dont le
    // parsage a lieu au chargement du module — un import statique ferait
    // réclamer une clé API au `next build` (voir le commentaire de `page.tsx`).
    expect(page).toContain("await import('@/content')");
    expect(page).not.toMatch(/from\s+['"]@\/content['"]/);
    // Et le rendu reste à la requête (AD-2) : sans cet export, Next pré-rendrait
    // `/fr` et `/en` au build, contenu figé dans l'artefact.
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/);
    for (const interdit of [
      'agentProjection',
      'corpus',
      'qaEntry',
      'contactPhone',
      'referenceContact',
      'photo('
    ]) {
      expect(page.includes(interdit), `page.tsx ne doit pas appeler ${interdit}`).toBe(false);
    }

    // Les autres composants ne reçoivent que des **types** : un `import type`
    // disparaît à la compilation, donc rien n'y lit le contenu.
    for (const entry of versContent.filter((item) => !item.path.endsWith('page.tsx'))) {
      const source = sources.find((file) => file.path === entry.path)!.source;
      expect(source, `${entry.path} nʼimporte que des types de @/content`).toContain(
        "import type {DisplayProjection} from '@/content'"
      );
    }
  });
});

describe('le thème sombre vit dans globals.css, jamais dans un composant', () => {
  it('nʼemploie aucune variante `dark:` dans les sources de la page', () => {
    // Les jetons de couleur basculent seuls avec `prefers-color-scheme` ; une
    // variante `dark:` locale serait une deuxième source de vérité, et la
    // première à diverger.
    const fautes = sources.flatMap((file) =>
      [...file.source.matchAll(/\bdark:[a-z-]+/g)].map((match) => `${file.path} : ${match[0]}`)
    );
    expect(fautes).toEqual([]);
  });
});

describe('un champ optionnel absent ne laisse ni vide ni ponctuation orpheline', () => {
  it('assemble seulement ce qui est là', () => {
    expect(joinParts(['Société Fictive SA', 'Genève'])).toBe('Société Fictive SA · Genève');
    expect(joinParts([undefined, 'Genève'])).toBe('Genève');
    expect(joinParts(['Société Fictive SA', undefined])).toBe('Société Fictive SA');
  });

  it('rend `undefined` — et non une chaîne vide — quand il ne reste rien', () => {
    // La différence compte : l'appelant retire l'élément entier au lieu de
    // rendre une ligne vide qui occupe quand même sa hauteur.
    expect(joinParts([undefined, undefined])).toBeUndefined();
    expect(joinParts([])).toBeUndefined();
    expect(joinParts(['', '   ', null])).toBeUndefined();
  });

  it('réduit une date de contenu à son année, sous ses trois formes', () => {
    expect(yearOf('2006')).toBe('2006');
    expect(yearOf('2024-06')).toBe('2024');
    expect(yearOf('2006-07-06')).toBe('2006');
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf('  ')).toBeUndefined();
  });

  it('rend telle quelle une date qui nʼest pas une année', () => {
    // Tronquer « janvier 2022 » aux quatre premiers caractères afficherait
    // « janv » : mieux vaut servir ce que le contenu dit.
    expect(yearOf('janvier 2022')).toBe('janvier 2022');
  });

  it('écrit une période sans tiret orphelin', () => {
    expect(periodLabel('2018-09', '2023-06', 'aujourd’hui')).toBe('2018 — 2023');
    expect(periodLabel('2024-06', undefined, 'aujourd’hui')).toBe('2024 — aujourd’hui');
    expect(periodLabel(undefined, '2023-06', 'aujourd’hui')).toBe('2023');
    expect(periodLabel(undefined, undefined, 'aujourd’hui')).toBeUndefined();
  });

  it('écrit une seule année quand la période tient dedans', () => {
    expect(periodLabel('2021-03', '2021-12', 'aujourd’hui')).toBe('2021');
  });
});

describe('monthYearLabel', () => {
  it('écrit le mois et lʼannée dans la langue de la page, sans glisser dʼun fuseau', () => {
    expect(monthYearLabel('2023-06-30', 'fr')).toBe('juin 2023');
    expect(monthYearLabel('2023-06-30', 'en')).toBe('June 2023');
    expect(monthYearLabel('2026-09', 'fr')).toBe('septembre 2026');
    // Le 1er du mois à minuit UTC reste dans son mois, quel que soit le fuseau du serveur.
    expect(monthYearLabel('2024-01-01', 'fr')).toBe('janvier 2024');
  });

  it('rend telle quelle une valeur qui nʼest pas une date ISO, et rien pour rien', () => {
    expect(monthYearLabel('2023', 'fr')).toBe('2023');
    expect(monthYearLabel('été 2023', 'fr')).toBe('été 2023');
    expect(monthYearLabel(undefined, 'fr')).toBeUndefined();
    expect(monthYearLabel('  ', 'fr')).toBeUndefined();
  });
});

describe('les chiffres du premier écran se déduisent, ils ne sʼécrivent pas', () => {
  const experiences = display.fr!.experiences;

  it('compte les années du parcours de la première date à la dernière', () => {
    expect(careerYears(experiences, NOW)).toBe(2026 - 2014);
  });

  it('compte jusquʼà lʼannée courante quand une expérience court toujours', () => {
    expect(careerYears([{debut: '2006-10'}], new Date('2026-09-15T12:00:00Z'))).toBe(20);
  });

  it('ne confond pas une fin illisible avec une fin absente', () => {
    // « janvier 2022 » n'est pas une date que `yearOf` lit ; elle est ignorée,
    // elle ne fait pas courir l'expérience jusqu'à aujourd'hui.
    expect(careerYears([{debut: '2010', fin: 'janvier 2022'}], NOW)).toBeUndefined();
    expect(
      careerYears([{debut: '2010', fin: '2015'}, {debut: '2016', fin: 'janvier 2022'}], NOW)
    ).toBe(5);
  });

  it('retient la fin la plus tardive quand une expérience en cours en côtoie une future', () => {
    expect(careerYears([{debut: '2010'}, {debut: '2020', fin: '2030'}], NOW)).toBe(20);
  });

  it('ne compte pas les employeurs absents dʼune interruption dʼactivité', () => {
    // La fixture porte trois expériences dont une sans employeur
    // (`entreprise: null`) : elle compte dans la durée, pas dans le total.
    expect(experiences).toHaveLength(3);
    expect(employerCount(experiences)).toBe(2);
  });

  it('ne rend aucun chiffre plutôt quʼun zéro quand il nʼy a rien à compter', () => {
    expect(careerYears([], NOW)).toBeUndefined();
    expect(employerCount([])).toBeUndefined();
    expect(careerYears([{debut: '2026-01', fin: '2026-02'}], NOW)).toBeUndefined();
  });
});
