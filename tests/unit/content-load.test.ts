/**
 * AD-2 — le chargement : ce qui fait démarrer, ce qui fait échouer, ce qui se
 * contente d'un avertissement.
 *
 * Chaque ligne de la matrice d'entrées-sorties de la story est couverte ici, sur
 * des répertoires temporaires construits à partir des fixtures fictives. Le
 * dépôt ne contient donc aucun contenu cassé : le contenu cassé est fabriqué au
 * moment du test, et disparaît avec lui.
 */
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  ContentError,
  formatIssue,
  loadContent,
  logContentWarnings,
  type Content,
  type ContentIssue
} from '@/content/load';

const FIXTURES = fileURLToPath(new URL('../fixtures/content', import.meta.url));
const NOW = new Date('2026-09-08T12:00:00Z');
const temporaires: string[] = [];

afterAll(() => {
  for (const dir of temporaires) rmSync(dir, {recursive: true, force: true});
});

/**
 * Copie les fixtures dans un répertoire jetable, puis applique des retouches :
 * `null` supprime un fichier, une chaîne le remplace, une fonction le réécrit.
 */
function contentDir(patch: Record<string, string | null | ((source: string) => string)> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-content-'));
  temporaires.push(dir);
  cpSync(FIXTURES, dir, {recursive: true});
  for (const [name, change] of Object.entries(patch)) {
    const target = join(dir, name);
    if (change === null) {
      rmSync(target, {force: true, recursive: true});
      continue;
    }
    mkdirSync(dirname(target), {recursive: true});
    const source = existsSync(target) ? readFileSync(target, 'utf8') : '';
    writeFileSync(target, typeof change === 'function' ? change(source) : change, 'utf8');
  }
  return dir;
}

/** Une entrée Q/R complète, à coller dans un fichier de corpus. */
function entree(id: string, corps: string, consigne?: string) {
  return [
    `#### \`${id}\` — Question fictive ${id} ?`,
    '**Réponse :**',
    corps,
    ...(consigne === undefined ? [] : ['', `> **Consigne à l'agent :** ${consigne}`]),
    ''
  ].join('\n');
}

const CORPUS_MINIMAL = ['## 1. Bloc fictif', '', entree('abc-01', 'Un corps fictif.')].join('\n');

describe('contenu valide', () => {
  // Chargé dans un `beforeAll` : au niveau du `describe`, une exception se
  // produirait pendant la collecte des tests, et Vitest signalerait un fichier
  // en échec sans dire lequel des cas a cassé.
  let content: Content;
  let warnings: readonly ContentIssue[];

  beforeAll(() => {
    ({content, warnings} = loadContent(contentDir(), {now: NOW}));
  });

  it('rend les deux projections et les deux corpus', () => {
    expect(Object.keys(content.cv.display).sort()).toEqual(['en', 'fr']);
    expect(Object.keys(content.cv.agent).sort()).toEqual(['en', 'fr']);
    expect(content.qa.fr.length).toBeGreaterThan(0);
    expect(content.qa.fr).toHaveLength(content.qa.en.length);
  });

  it('signale l’entrée vide de la fixture, et rien de plus grave', () => {
    // Par inclusion, pas par égalité : ajouter demain un avertissement légitime
    // ne doit pas casser un test qui parle d'autre chose.
    const messages = warnings.map(formatIssue);
    expect(messages.filter((message) => message.includes('vid-01'))).toHaveLength(2);
    expect(messages.filter((message) => message.includes('identite.photo'))).toEqual([]);
  });

  it('gèle le contenu : personne ne le modifie après le démarrage', () => {
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.qa.fr)).toBe(true);
    expect(Object.isFrozen(content.cv.display.fr.identite)).toBe(true);
    expect(() => {
      (content.qa.fr as unknown as unknown[]).push({});
    }).toThrow();
  });

  it('indexe les entrées par identifiant, dans chaque langue', () => {
    expect(content.byId.fr['par-01']?.question).toBe(
      'Quel est le parcours de la personne fictive ?'
    );
    expect(content.byId.en['par-01']?.question).toBe(
      "What is the fictional person's background?"
    );
  });

  it("d'une entrée PRIVÉ, ne donne que l'identifiant, le statut et la consigne", () => {
    const entry = content.byId.fr['sal-01']!;
    expect(entry.id).toBe('sal-01');
    expect(entry.statut).toBe('PRIVÉ');
    expect(entry.consigne).toContain('ne jamais communiquer de montant');
    expect(entry).not.toHaveProperty('corps');
  });
});

describe('fichier requis absent — échec du démarrage', () => {
  it.each(['cv.yaml', 'qa.fr.md'])('refuse de démarrer sans %s, en le nommant', (file) => {
    const dir = contentDir({[file]: null});
    expect(() => loadContent(dir)).toThrowError(ContentError);
    expect(() => loadContent(dir)).toThrowError(new RegExp(file.replace('.', '\\.')));
  });
});

describe('qa.en.md absent — démarrage normal, corpus anglais vide', () => {
  const {content, warnings} = loadContent(contentDir({'qa.en.md': null}), {now: NOW});

  it('démarre quand même', () => {
    expect(content.qa.fr.length).toBeGreaterThan(0);
    expect(content.qa.en).toEqual([]);
  });

  it('le dit, plutôt que de se taire', () => {
    expect(warnings.map(formatIssue).join('\n')).toContain('qa.en.md');
  });
});

describe('anomalies du corpus — échec du démarrage', () => {
  it('nomme une entrée à marqueur inconnu et sa ligne', () => {
    const dir = contentDir({
      'qa.fr.md': `${CORPUS_MINIMAL}\n${entree('abc-02', '[BROUILLON] à relire.')}`,
      'qa.en.md': null
    });
    const error = attrape(dir);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatchObject({
      file: 'qa.fr.md',
      entry: 'abc-02',
      line: expect.any(Number)
    });
    expect(error.message).toContain('crochets');
    // Ce message part sur stderr, donc dans le journal du service : il ne doit
    // rien contenir du corps de l'entrée.
    expect(error.message).not.toContain('BROUILLON');
  });

  it('nomme un identifiant dupliqué', () => {
    const dir = contentDir({
      'qa.fr.md': `${CORPUS_MINIMAL}\n${entree('abc-01', 'Un autre corps.')}`,
      'qa.en.md': null
    });
    expect(attrape(dir).issues[0]).toMatchObject({entry: 'abc-01'});
  });

  it('nomme une entrée orpheline en anglais : le français fait foi', () => {
    const dir = contentDir({
      'qa.fr.md': CORPUS_MINIMAL,
      'qa.en.md': `${CORPUS_MINIMAL}\n${entree('zzz-99', 'An orphan body.')}`
    });
    const error = attrape(dir);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatchObject({file: 'qa.en.md', entry: 'zzz-99'});
    expect(error.message).toContain('orpheline');
  });

  it('rend toutes les anomalies en une fois, pas la première', () => {
    const dir = contentDir({
      'qa.fr.md': [
        CORPUS_MINIMAL,
        entree('abc-02', '[BROUILLON]'),
        entree('abc-01', 'Doublon.'),
        entree('abc-03', 'PRIVÉ\n\nmais suivi de texte.')
      ].join('\n'),
      'qa.en.md': `${CORPUS_MINIMAL}\n${entree('zzz-99', 'Orphan.')}`
    });
    const error = attrape(dir);
    expect(error.issues.map((issue) => issue.entry)).toEqual([
      'abc-02',
      'abc-01',
      'abc-03',
      'zzz-99'
    ]);
  });

  it('rattache une anomalie de cv.yaml à sa ligne', () => {
    const dir = contentDir({'cv.yaml': 'identite:\n  prenom: Camille\n', 'qa.fr.md': CORPUS_MINIMAL});
    const error = attrape(dir);
    expect(error.issues.every((issue) => issue.file === 'cv.yaml')).toBe(true);
    expect(error.issues.some((issue) => issue.field?.startsWith('identite'))).toBe(true);
    expect(error.issues.some((issue) => typeof issue.line === 'number')).toBe(true);
  });

  it('refuse un cv.yaml illisible plutôt que de deviner', () => {
    const dir = contentDir({'cv.yaml': 'identite:\n  prenom: [ non fermé\n'});
    expect(attrape(dir).issues[0]!.message).toContain('YAML');
  });
});

describe('ce qui ne mérite qu’un avertissement', () => {
  it('signale une traduction en retard, en listant les identifiants', () => {
    const {content, warnings} = loadContent(
      contentDir({
        'qa.fr.md': `${CORPUS_MINIMAL}\n${entree('abc-02', 'Pas encore traduite.')}`,
        'qa.en.md': CORPUS_MINIMAL
      }),
      {now: NOW}
    );
    expect(content.qa.fr).toHaveLength(2);
    expect(content.qa.en).toHaveLength(1);
    expect(warnings.map(formatIssue).join('\n')).toContain('abc-02');
  });

  it('conserve une entrée au corps vide, et la liste', () => {
    const {content, warnings} = loadContent(
      contentDir({
        'qa.fr.md': `${CORPUS_MINIMAL}\n${entree('abc-02', '')}`,
        'qa.en.md': null
      }),
      {now: NOW}
    );
    expect(content.byId.fr['abc-02']?.statut).toBe('vide');
    expect(warnings.map(formatIssue).join('\n')).toContain('abc-02');
  });

  it('ignore un champ inconnu de cv.yaml, sans le projeter, en le signalant', () => {
    const dir = contentDir({
      'cv.yaml': (source) => `${source}\nchamp_inconnu: SentinelleChampInconnu\n`
    });
    const {content, warnings} = loadContent(dir, {now: NOW});
    const texte = JSON.stringify(content.cv);
    expect(texte).not.toContain('SentinelleChampInconnu');
    expect(warnings.map(formatIssue).join('\n')).toContain('champ_inconnu');
  });

  it('démarre sans photo quand le fichier est introuvable', () => {
    const {content, warnings} = loadContent(contentDir({'assets/photo-fictive.jpg': null}), {
      now: NOW
    });
    expect(content.cv.display.fr.identite.photo).toBe(false);
    expect(content.restricted.photo).toBeNull();
    expect(warnings.map(formatIssue).join('\n')).toContain('identite.photo');
  });

  it('refuse de suivre un chemin de photo qui sort de CONTENT_DIR', () => {
    const dir = contentDir({
      'cv.yaml': (source) => source.replace('assets/photo-fictive.jpg', '../../hors-perimetre.jpg')
    });
    const {content, warnings} = loadContent(dir, {now: NOW});
    expect(content.cv.display.fr.identite.photo).toBe(false);
    expect(content.restricted.photo).toBeNull();
    expect(warnings.map(formatIssue).join('\n')).toContain('CONTENT_DIR');
  });
});

/**
 * Ce que `CONTENT_DIR` contient et qu'aucune projection ne porte (AD-8) : le
 * chemin de la photo et le téléphone. Ils restent dans `restricted`, hors de
 * `content.cv`, parce que ce qui est dans `cv` est précisément ce qui sort.
 */
describe('ce qui ne sort que par une route nommée', () => {
  it('garde la photo — chemin, type, octets et version — hors de cv', () => {
    const {content} = loadContent(FIXTURES, {now: NOW});
    const photo = content.restricted.photo!;

    expect(photo.mime).toBe('image/jpeg');
    expect(photo.path).toContain('photo-fictive.jpg');
    expect(photo.bytes.byteLength).toBe(readFileSync(photo.path).byteLength);
    // Un condensé des octets, pas une date : la même photo déployée ailleurs
    // garde le même ETag, et les navigateurs leur `304`.
    expect(photo.etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(photo.etag).toBe(loadContent(contentDir(), {now: NOW}).content.restricted.photo!.etag);
    // La projection n'en annonce que la présence, jamais le chemin.
    expect(content.cv.display.fr.identite.photo).toBe(true);
    expect(JSON.stringify(content.cv)).not.toContain('photo-fictive.jpg');
  });

  it('lit les octets une fois : la photo survit à la disparition du fichier (AD-2)', () => {
    const dir = contentDir();
    const {content} = loadContent(dir, {now: NOW});
    const photo = content.restricted.photo!;

    rmSync(photo.path, {force: true});
    expect(photo.bytes.byteLength).toBeGreaterThan(0);
  });

  it('démarre sans photo, avec un avertissement, quand le fichier est illisible', () => {
    // Un répertoire portant une extension d'image : `existsSync` le voit, la
    // lecture échoue (EISDIR). Avertissement, pas arrêt.
    const dir = contentDir({'assets/photo-fictive.jpg': null});
    mkdirSync(join(dir, 'assets/photo-fictive.jpg'));

    const {content, warnings} = loadContent(dir, {now: NOW});

    expect(content.restricted.photo).toBeNull();
    expect(content.cv.display.fr.identite.photo).toBe(false);
    expect(warnings.map(formatIssue).join('\n')).toMatch(/identite\.photo.*illisible/);
  });

  it("refuse une photo dont l'extension n'est pas un type d'image connu", () => {
    const dir = contentDir({
      'assets/photo-fictive.txt': 'ceci nʼest pas une image',
      'cv.yaml': (source) =>
        source.replace('assets/photo-fictive.jpg', 'assets/photo-fictive.txt')
    });
    const {content, warnings} = loadContent(dir, {now: NOW});

    // Servir un fichier arbitraire de CONTENT_DIR sous un type deviné serait
    // pire qu'une page sans photo.
    expect(content.restricted.photo).toBeNull();
    expect(content.cv.display.fr.identite.photo).toBe(false);
    expect(warnings.map(formatIssue).join('\n')).toContain("type d'image inconnu");
  });

  it('garde le téléphone hors des deux projections, et le rend accessible à la route', () => {
    const {content} = loadContent(FIXTURES, {now: NOW});

    expect(content.restricted.telephone).toBe('+41 00 000 00 07');
    expect(JSON.stringify(content.cv)).not.toContain('+41 00 000 00 07');
  });

  it('rend `null` plutôt que `undefined` quand cv.yaml nʼa pas de téléphone', () => {
    const dir = contentDir({
      'cv.yaml': (source) => source.replace('  telephone: "+41 00 000 00 07"\n', '')
    });
    expect(loadContent(dir, {now: NOW}).content.restricted.telephone).toBeNull();
  });
});

describe('journalisation des avertissements', () => {
  it('écrit une ligne JSON par avertissement, sans jamais un corps d’entrée', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logContentWarnings([{file: 'qa.en.md', message: 'fichier absent'}]);
    expect(warn).toHaveBeenCalledTimes(1);
    const ligne: unknown = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(ligne).toMatchObject({level: 'warn', event: 'content.warning', file: 'qa.en.md'});
    warn.mockRestore();
  });

  it('situe une anomalie par fichier, ligne et entrée', () => {
    expect(formatIssue({file: 'qa.fr.md', line: 41, entry: 'ia-08', message: 'marqueur'})).toBe(
      'qa.fr.md:41 [ia-08] — marqueur'
    );
    expect(formatIssue({file: 'cv.yaml', message: 'absent'})).toBe('cv.yaml — absent');
  });
});

describe('surface publique de la couche', () => {
  it("n'expose que les projections, les corpus, les entrées, les statuts et les deux à-la-demande", async () => {
    const surface = await import('@/content');
    expect(Object.keys(surface).sort()).toEqual(
      [
        'ContentError',
        'LANGS',
        'QA_STATUSES',
        'agentProjection',
        // Hors projection, servis seulement par une route nommée (AD-8) :
        'contactPhone',
        'photo',
        'corpus',
        'displayProjection',
        'ensureContent',
        'qaEntry',
        'qaStatus'
      ].sort()
    );
  });

  it('sert le même contenu gelé à chaque appel : une seule lecture disque', async () => {
    const {corpus, displayProjection, agentProjection, qaEntry, qaStatus} = await import('@/content');
    expect(corpus('fr')).toBe(corpus('fr'));
    // La projection est réassemblée à chaque lecture — pour l'âge, voir plus
    // bas — mais tout ce qu'elle porte reste le même objet gelé.
    expect(displayProjection('fr').experiences).toBe(displayProjection('fr').experiences);
    expect(Object.isFrozen(displayProjection('fr').experiences)).toBe(true);
    expect(displayProjection('en').experiences).not.toBe(displayProjection('fr').experiences);
    expect(agentProjection('fr').identite.source).toBe('cv:identite');
    expect(qaEntry('fr', 'par-01')?.etoile).toBe(true);
    expect(qaStatus('fr', 'sal-01')).toBe('PRIVÉ');
    expect(qaStatus('fr', 'inconnu-99')).toBeUndefined();
  });

  it('recalcule lʼâge à chaque lecture : un anniversaire ne demande pas de redémarrage', async () => {
    const {displayProjection, agentProjection} = await import('@/content');
    // Camille Durand, fixture, née le 1988-04-12.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-04-11T12:00:00Z'));
      expect(displayProjection('fr').identite.age).toBe(41);
      vi.setSystemTime(new Date('2030-04-12T12:00:00Z'));
      expect(displayProjection('fr').identite.age).toBe(42);
      expect(agentProjection('en').identite.age).toBe(42);
      // La date elle-même, elle, reste celle de la projection.
      expect(displayProjection('fr').identite.date_naissance).toBe('1988-04-12');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('un corpus muet n’est pas un corpus valide', () => {
  it('refuse de démarrer si qa.fr.md ne produit aucune entrée', () => {
    // Le fichier est là, lisible, sans une seule entrée : le site démarrerait
    // avec un corpus vide et refuserait chaque question, sans que rien ne l'ait dit.
    const dir = contentDir({'qa.fr.md': '# Un titre, et rien d’autre.\n', 'qa.en.md': null});
    expect(attrape(dir).issues[0]).toMatchObject({file: 'qa.fr.md'});
    expect(attrape(dir).message).toContain('aucune entrée');
  });

  it('signale les 232 traductions manquantes d’un qa.en.md présent mais vide', () => {
    // La garde portait sur le nombre d'entrées anglaises : à zéro, elle se taisait.
    // Une seule traduction manquante était signalée, toutes ne l'étaient pas.
    const {content, warnings} = loadContent(
      contentDir({
        'qa.fr.md': CORPUS_MINIMAL,
        'qa.en.md': '# A title, and nothing else.\n'
      }),
      {now: NOW}
    );
    expect(content.qa.en).toEqual([]);
    expect(warnings.map(formatIssue).join('\n')).toContain('abc-01');
  });
});

describe('replis de langue dans cv.yaml', () => {
  it('journalise un champ bilingue dont la version anglaise manque', () => {
    // Sinon le modèle reçoit du français alors qu'on lui demande de répondre en
    // anglais — même règle que pour les corpus Q/R (AD-5).
    const dir = contentDir({
      'cv.yaml': (source) =>
        source.replace('    en: Software developer', "    en: ''")
    });
    const {content, warnings} = loadContent(dir, {now: NOW});
    expect(content.cv.agent.en.identite.titre).toBe('Développeuse logiciel');
    const message = warnings.map(formatIssue).join('\n');
    expect(message).toContain('identite.titre');
    expect(message).toContain('« en »');
  });
});

describe('index par identifiant', () => {
  it("ne rend rien pour une clé héritée d'Object", () => {
    // Les identifiants viendront de citations produites par le modèle : sur un
    // objet ordinaire, `toString` rendrait une fonction typée `QaEntry`.
    const {content} = loadContent(contentDir(), {now: NOW});
    for (const clé of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(content.byId.fr[clé]).toBeUndefined();
    }
  });
});

describe('photo absente du fichier', () => {
  it('signale un champ identite.photo totalement absent', () => {
    const dir = contentDir({
      'cv.yaml': (source) => source.replace('  photo: assets/photo-fictive.jpg\n', '')
    });
    const {content, warnings} = loadContent(dir, {now: NOW});
    expect(content.cv.display.fr.identite.photo).toBe(false);
    expect(warnings.map(formatIssue).join('\n')).toContain('identite.photo');
  });
});

/** Récupère la `ContentError` levée par un chargement, ou fait échouer le test. */
function attrape(dir: string): ContentError {
  try {
    loadContent(dir, {now: NOW});
  } catch (error) {
    if (error instanceof ContentError) return error;
    throw error;
  }
  throw new Error(`le chargement de ${dir} aurait dû échouer`);
}
