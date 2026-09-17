/**
 * AD-3 / AD-4 / AD-5 — la couche `knowledge` sur la fixture : ce que le noyau
 * contient, ce qu'il ne contient jamais, ce que l'index rend, et ce qui se
 * cite. Le contenu est celui de `tests/fixtures/content/` (`setup-env.ts`) :
 * 15 entrées, dont `sys-01..03`, `sal-01` PRIVÉ avec consigne, `sit-01` à
 * consigne, `obs-01` PASSE, `vid-01` vide, et le cv.yaml fictif aux sentinelles.
 */
import {mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {stripMarkdown} from '@/knowledge/strip-markdown';
import {sentinelles} from './sentinelles';

const FIXTURES = fileURLToPath(new URL('../fixtures/content', import.meta.url));

type Knowledge = typeof import('@/knowledge');
let knowledge: Knowledge;

/** Le module et son état, neufs pour chaque cas : l'état vit sur `globalThis`. */
async function fresh(): Promise<Knowledge> {
  vi.resetModules();
  const loaded = await import('@/knowledge');
  loaded.resetKnowledge();
  return loaded;
}

beforeEach(async () => {
  knowledge = await fresh();
});

afterEach(() => {
  knowledge.resetKnowledge();
  vi.restoreAllMocks();
});

describe('le texte débalisé (index seulement)', () => {
  it('retire titres, emphase, listes, liens, code et citations, garde les mots', () => {
    const texte = [
      '# Titre',
      '',
      '> **Consigne** citée',
      '',
      '- item *italique* et _souligné_',
      '1. `code` et [lien](https://exemple.invalid/x) et ![image](i.png)',
      '',
      '```',
      'bloc de code',
      '```',
      '',
      '---',
      'Fin \\*échappée\\* <b>html</b>'
    ].join('\n');

    expect(stripMarkdown(texte)).toBe(
      'Titre\n\nConsigne citée\n\nitem italique et souligné\ncode et lien et image\n\nbloc de code\n\nFin *échappée* html'
    );
  });

  it('ne prend pas un tiret bas intra-mot pour une emphase', () => {
    expect(stripMarkdown('cv_visitor et snake_case_name, mais _souligné_ et __gras__ ; a_b_c')).toBe(
      'cv_visitor et snake_case_name, mais souligné et gras ; a_b_c'
    );
  });

  it('ne touche ni aux mots ni à leur ordre : un corps sans balisage sort tel quel, espaces normalisés', () => {
    expect(stripMarkdown('Douze ans  dʼexpérience inventée.')).toBe('Douze ans dʼexpérience inventée.');
    expect(stripMarkdown('')).toBe('');
  });
});

describe('ensureKnowledge', () => {
  it('construit les deux langues et rend leurs tailles — jamais un texte', () => {
    const stats = knowledge.ensureKnowledge();

    expect(stats.map((entry) => entry.lang)).toEqual(['fr', 'en']);
    for (const entry of stats) {
      expect(entry.corpusLang).toBe(entry.lang);
      expect(entry.coreChars).toBeGreaterThan(1000);
      // 13 titres : 15 entrées moins obs-01 (PASSE) et vid-01 (vide) — sal-01 (PRIVÉ) y est, marquée.
      expect(entry.titles).toBe(13);
      // Indexées : les normales hors sys-* — par-01, par-02, sit-01, i2k-01 et les cinq du hero.
      expect(entry.indexed).toBe(9);
      // Consignes : sit-01 (consigne) et sal-01 (PRIVÉ + consigne).
      expect(entry.directives).toBe(2);
      expect(Object.values(entry).every((value) => typeof value === 'number' || value.length <= 2)).toBe(true);
    }
  });
});

describe('le noyau', () => {
  it('est identique octet pour octet dʼun appel à lʼautre, et dʼune construction à lʼautre', async () => {
    const premier = knowledge.core('fr');
    expect(knowledge.core('fr')).toBe(premier);

    const autre = await fresh();
    expect(autre.core('fr')).toBe(premier);
    expect(autre.core('en')).toBe(knowledge.core('en'));
  });

  it('porte la projection agent avec ses clés de citation, et lʼindex des titres', () => {
    const noyau = knowledge.core('fr');

    expect(noyau).toContain('<cv>');
    expect(noyau).toContain('"source": "cv:identite"');
    expect(noyau).toContain('"source": "cv:experiences.outillage-interne"');
    expect(noyau).toContain('"source": "cv:formation.certificat-annexe"');
    expect(noyau).toContain('camille.durand@exemple.invalid');
    expect(noyau).toContain('<titles>');
    expect(noyau).toContain('qa:par-01 — Quel est le parcours de la personne fictive ?');
    expect(noyau).toContain('qa:lic-01 — ');
    // PRIVÉ : le titre existe, marqué ; le corps, jamais.
    expect(noyau).toContain('qa:sal-01 [PRIVÉ] — Quelle était sa dernière rémunération ?');
  });

  it('porte le corps des sys-* et les consignes des entrées PRIVÉ ou à consigne', () => {
    const noyau = knowledge.core('fr');

    expect(noyau).toContain('<behaviour>');
    expect(noyau).toContain('## qa:sys-01 — Que répondre à une question hors périmètre ?');
    expect(noyau).toContain('sans\nbloc de sources');
    expect(noyau).toContain('## qa:sys-03');
    expect(noyau).toContain('<directives>');
    expect(noyau).toContain('## qa:sit-01 — Pourquoi cherche-t-elle un poste ?\nne mentionner ce motif');
    expect(noyau).toContain('## qa:sal-01 [PRIVÉ] — Quelle était sa dernière rémunération ?\nne jamais communiquer de montant');
  });

  it('ne porte ni corps PRIVÉ, ni entrée PASSE, ni entrée vide, ni sentinelle hors liste blanche', () => {
    for (const lang of ['fr', 'en'] as const) {
      const noyau = knowledge.core(lang);
      // La fixture ne donne aucun corps à sal-01 (c'est « PRIVÉ ») : le mot
      // seul, sans montant, prouve que rien d'autre que la consigne n'est passé.
      expect(noyau).not.toMatch(/\nPRIVÉ\n/);
      expect(noyau).not.toContain('obs-01');
      expect(noyau).not.toContain('vid-01');
      expect(noyau).not.toContain('PASSE');
      expect(sentinelles.filter((value) => noyau.includes(value))).toEqual([]);
      // Aucune date du jour, aucun identifiant de requête : rien d'autre que le contenu.
      expect(noyau).not.toContain(new Date().toISOString().slice(0, 10));
    }
  });

  it('est monolingue : le noyau anglais vient de qa.en.md et de la projection anglaise', () => {
    const noyau = knowledge.core('en');

    expect(noyau).toContain('qa:par-01 — What is the fictional person\'s background?');
    expect(noyau).toContain('"titre": "AI-Assisted Development — Software & Web Developer"');
    expect(noyau).not.toContain('Quel est le parcours');
    expect(knowledge.corpusLang('en')).toBe('en');
  });
});

describe('la récupération', () => {
  it('rend les entrées ordinaires les mieux classées, la question boostée, jamais sys-* ni PRIVÉ', () => {
    const trouvees = knowledge.retrieve('fr', 'Quelles technologies fictives ?');

    expect(trouvees.length).toBeGreaterThan(0);
    expect(trouvees[0]!.id).toBe('par-02');
    expect(trouvees[0]).toEqual({
      id: 'par-02',
      source: 'qa:par-02',
      question: 'Sur quelles technologies fictives travaille-t-elle ?',
      corps: 'Langage-Fictif et Pseudo-SQL au quotidien, Atelier-Imaginaire sur l\'historique.'
    });
    const ids = trouvees.map((entry) => entry.id);
    expect(ids.some((id) => id.startsWith('sys-'))).toBe(false);
    expect(ids).not.toContain('sal-01');
    expect(ids).not.toContain('obs-01');
    expect(ids).not.toContain('vid-01');
  });

  it('cherche sur le texte débalisé : un mot en gras ou dans une liste se retrouve', () => {
    // « inventée » n'est que dans le corps de par-01, en gras (`**inventée**`).
    expect(knowledge.retrieve('fr', 'expérience inventée').map((entry) => entry.id)).toContain('par-01');
    // « spécification » n'est que dans un item de liste de ia-01.
    expect(knowledge.retrieve('fr', 'spécification').map((entry) => entry.id)).toContain('ia-01');
  });

  it('ignore les accents et la casse', () => {
    expect(knowledge.retrieve('fr', 'REMUNERATION disponible').map((entry) => entry.id)).toContain('sit-02');
  });

  it('garde un terme dʼun seul caractère : une question sur « C » ou « R » récupère quelque chose', () => {
    // « à » (par-01 : « de 2014 à 2021 ») s'indexe en « a », un caractère.
    expect(knowledge.retrieve('fr', 'à').map((entry) => entry.id)).toContain('par-01');
  });

  it('borne à k = 12 par défaut, et à ce quʼon lui demande', () => {
    // Une requête qui touche tout : chaque entrée indexée porte au moins un de ces mots.
    const large = 'fictive fictif imaginaire inventée personne site méthode';
    expect(knowledge.retrieve('fr', large).length).toBeLessThanOrEqual(12);
    expect(knowledge.retrieve('fr', large, 2)).toHaveLength(2);
    expect(knowledge.retrieve('fr', large, 0)).toEqual([]);
    expect(knowledge.retrieve('fr', '   ')).toEqual([]);
    expect(knowledge.retrieve('fr', 'zzzzzz')).toEqual([]);
  });

  it('rend le corps en Markdown tel quʼécrit, pas la version débalisée', () => {
    const [entree] = knowledge.retrieve('fr', 'parcours de la personne fictive', 1);
    expect(entree!.id).toBe('par-01');
    expect(entree!.corps).toContain('**inventée**');
    expect(entree!.corps).toContain('- Applications de gestion');
  });
});

describe('les sources valides (AD-4)', () => {
  it.each([
    ['qa:par-01', true],
    ['qa:sys-01', true],
    ['qa:sit-01', true],
    ['qa:lic-01', true],
    ['cv:identite', true],
    ['cv:profil', true],
    ['cv:experiences.conge-parental', true],
    ['cv:formation.certificat-annexe', true],
    ['cv:competences.methodes-fictives', true],
    ['cv:certificats_travail.outillage-interne', true],
    ['cv:lettre_motivation', true],
    ['qa:sal-01', false],
    ['qa:obs-01', false],
    ['qa:vid-01', false],
    ['qa:inexistante', false],
    ['cv:contact.telephone', false],
    ['cv:references.reference-fictive', false],
    ['par-01', false],
    ['', false],
    ['toString', false]
  ])('« %s » → %s', (id, attendu) => {
    expect(knowledge.isValidSource('fr', id)).toBe(attendu);
    expect(knowledge.isValidSource('en', id)).toBe(attendu);
  });
});

describe('repli de langue (AD-5)', () => {
  let dir: string;
  const saved = process.env.CONTENT_DIR;

  beforeEach(() => {
    // Un contenu sans qa.en.md : le corpus anglais est vide.
    dir = mkdtempSync(join(tmpdir(), 'cv-knowledge-'));
    copyFileSync(join(FIXTURES, 'cv.yaml'), join(dir, 'cv.yaml'));
    copyFileSync(join(FIXTURES, 'qa.fr.md'), join(dir, 'qa.fr.md'));
    mkdirSync(join(dir, 'assets'));
    copyFileSync(join(FIXTURES, 'assets', 'photo-fictive.jpg'), join(dir, 'assets', 'photo-fictive.jpg'));
    process.env.CONTENT_DIR = dir;
  });

  afterEach(() => {
    process.env.CONTENT_DIR = saved;
    rmSync(dir, {recursive: true, force: true});
  });

  it('ancre /en sur le corpus français, avec la projection anglaise, et avertit une fois', async () => {
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = await fresh();

    const stats = local.ensureKnowledge();

    expect(local.corpusLang('en')).toBe('fr');
    expect(stats.find((entry) => entry.lang === 'en')).toMatchObject({corpusLang: 'fr', indexed: 9});
    const noyau = local.core('en');
    // Le corpus est français, la projection reste anglaise.
    expect(noyau).toContain('qa:par-01 — Quel est le parcours de la personne fictive ?');
    expect(noyau).toContain('"titre": "AI-Assisted Development — Software & Web Developer"');
    expect(local.retrieve('en', 'technologies fictives')[0]!.id).toBe('par-02');
    expect(local.isValidSource('en', 'qa:par-01')).toBe(true);
    // Une seule ligne d'avertissement, structurée, pour le repli.
    const lignes = avertit.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((ligne) => ligne.event === 'knowledge.corpus_fallback');
    expect(lignes).toEqual([expect.objectContaining({level: 'warn', lang: 'en', corpusLang: 'fr'})]);
    // Un second appel ne reconstruit rien, donc n'avertit pas.
    local.ensureKnowledge();
    expect(avertit.mock.calls.filter((call) => String(call[0]).includes('corpus_fallback'))).toHaveLength(1);
  });

  it('échoue tôt sur un contenu invalide : cʼest le chargement du contenu qui refuse', async () => {
    writeFileSync(join(dir, 'qa.fr.md'), '#### `abc-01` — Q ?\n**Réponse :**\n[BROUILLON] non\n', 'utf8');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = await fresh();

    expect(() => local.ensureKnowledge()).toThrowError(/qa\.fr\.md/);
  });
});
