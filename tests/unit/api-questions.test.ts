/**
 * `GET /api/questions/<id>?lang=` — les questions du premier écran, sans appel
 * au modèle (CAP-2, story 5). Chaque ligne de la matrice, côté route.
 *
 * Le contenu et le journal sont simulés : ce qui est prouvé ici, c'est ce que
 * la route **demande** à chacun — quelle entrée, dans quelle langue, ce qu'elle
 * écrit et surtout quand elle n'écrit pas — et ce qu'elle rend. La preuve sur
 * le contenu fictif réel et la base réelle est celle de
 * `tests/e2e/questions.spec.ts`, contre l'artefact de production.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NextRequest} from 'next/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {HERO_QUESTIONS, MATCH_QUESTION} from '@/app/(site)/[locale]/_components/hero-questions';
import type {QaEntry} from '@/content';

const contenu = vi.hoisted(() => ({qaEntry: vi.fn()}));
const journal = vi.hoisted(() => ({touchSession: vi.fn(), addExchange: vi.fn()}));

vi.mock('@/content', () => contenu);
vi.mock('@/journal', () => journal);

type Route = typeof import('@/app/api/questions/[id]/route');
let route: Route;

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const COOKIES = `cv_visitor=${VISITOR_ID}; cv_session=${SESSION_ID}.1757930400000`;
const EXCHANGE_ID = '01K4EXAMPXCHG0000000000000';

/** Une entrée ordinaire, telle que `qaEntry` la rend — corps Markdown, sans consigne. */
function entree(id: string, lang: 'fr' | 'en', overrides: Partial<QaEntry> = {}): QaEntry {
  return {
    id,
    source: `qa:${id}`,
    lang,
    ligne: 1,
    question: `Question fictive ${id} (${lang}) ?`,
    etoile: true,
    statut: 'normale',
    corps: `Corps **fictif** de ${id}.\n\n- en ${lang}\n- tel quel`,
    consigne: null,
    bloc: null,
    ...overrides
  };
}

/** Un appel à la route, avec ou sans cookies de visite. */
function appel(id: string, query = '?lang=fr', cookie?: string) {
  const request = new NextRequest(`http://127.0.0.1:3000/api/questions/${id}${query}`, {
    headers: cookie
      ? {cookie, host: '127.0.0.1:3000', referer: 'http://127.0.0.1:3000/fr', 'user-agent': 'Test/1.0'}
      : {host: '127.0.0.1:3000'}
  });
  return route.GET(request, {params: Promise.resolve({id})});
}

beforeEach(async () => {
  vi.resetAllMocks();
  // La route retient les entrées déjà signalées : chaque cas repart d'un module
  // neuf, sinon leur ordre déciderait de ce qu'ils prouvent.
  vi.resetModules();
  route = await import('@/app/api/questions/[id]/route');
  contenu.qaEntry.mockImplementation((lang: 'fr' | 'en', id: string) => entree(id, lang));
  journal.touchSession.mockReturnValue({outcome: 'prolonged', visitorCreated: false});
  journal.addExchange.mockReturnValue({id: EXCHANGE_ID});
});

describe('la route', () => {
  it('nʼest jamais rendue au build (AD-2)', () => {
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('clic sur une des cinq puces, avec cookies', () => {
  it.each(HERO_QUESTIONS)('%s : rend le corps exact, ses sources, et journalise un échange à coût nul', async (id) => {
    const reponse = await appel(id, '?lang=fr', COOKIES);

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await reponse.json()).toEqual({
      id,
      question: `Question fictive ${id} (fr) ?`,
      answer: `Corps **fictif** de ${id}.\n\n- en fr\n- tel quel`,
      sources: [`qa:${id}`],
      exchangeId: EXCHANGE_ID
    });
    expect(contenu.qaEntry).toHaveBeenCalledWith('fr', id);

    // Le geste prolonge la session (AD-14), dans la langue demandée…
    expect(journal.touchSession).toHaveBeenCalledTimes(1);
    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({visitorId: VISITOR_ID, sessionId: SESSION_ID, lang: 'fr'})
    );
    // …puis l'échange s'y rattache : `hero`, sources = la clé de citation, citations exactes.
    expect(journal.addExchange).toHaveBeenCalledTimes(1);
    expect(journal.addExchange).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      kind: 'hero',
      question: `Question fictive ${id} (fr) ?`,
      answer: `Corps **fictif** de ${id}.\n\n- en fr\n- tel quel`,
      sources: [`qa:${id}`],
      citationOk: true,
      latencyMs: expect.any(Number)
    });
    const {latencyMs} = journal.addExchange.mock.calls[0]![0] as {latencyMs: number};
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('transmet le corps tel quel : le Markdown nʼest ni rendu ni retouché', async () => {
    const corps = '  Espaces insécables et **gras**\n1. liste\n   indentée  \n\n_fin_';
    contenu.qaEntry.mockReturnValue(entree('lic-01', 'fr', {corps}));

    const {answer} = (await (await appel('lic-01', '?lang=fr', COOKIES)).json()) as {answer: string};

    expect(answer).toBe(corps);
  });
});

describe('même clic sans cookies', () => {
  it('répond le même corps, exchangeId null, et ne touche pas au journal', async () => {
    const reponse = await appel('sit-02');

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({
      id: 'sit-02',
      answer: 'Corps **fictif** de sit-02.\n\n- en fr\n- tel quel',
      sources: ['qa:sit-02'],
      exchangeId: null
    });
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(journal.addExchange).not.toHaveBeenCalled();
  });

  it('nʼécrit pas non plus avec des cookies qui ne sont pas des ULID', async () => {
    const reponse = await appel('sit-02', '?lang=fr', 'cv_visitor=forge; cv_session=forge.1');

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).exchangeId).toBeNull();
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(journal.addExchange).not.toHaveBeenCalled();
  });
});

describe('langue anglaise', () => {
  it('sert lʼentrée de qa.en.md et prolonge la session en anglais', async () => {
    const reponse = await appel('ia-01', '?lang=en', COOKIES);

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({
      question: 'Question fictive ia-01 (en) ?',
      answer: 'Corps **fictif** de ia-01.\n\n- en en\n- tel quel'
    });
    expect(contenu.qaEntry).toHaveBeenCalledWith('en', 'ia-01');
    expect(contenu.qaEntry).not.toHaveBeenCalledWith('fr', expect.anything());
    expect(journal.touchSession).toHaveBeenCalledWith(expect.objectContaining({lang: 'en'}));
  });
});

describe('identifiant hors des cinq', () => {
  it.each([MATCH_QUESTION, 'sal-02', 'sys-01', '../secret', 'LIC-01', 'lic-01 ', ''])(
    '« %s » : 404 unknown, rien lu, rien écrit',
    async (id) => {
      const reponse = await appel(id, '?lang=fr', COOKIES);

      expect(reponse.status).toBe(404);
      expect(await reponse.json()).toEqual({ok: false, reason: 'unknown'});
      expect(reponse.headers.get('cache-control')).toBe('private, no-store');
      expect(contenu.qaEntry).not.toHaveBeenCalled();
      expect(journal.touchSession).not.toHaveBeenCalled();
      expect(journal.addExchange).not.toHaveBeenCalled();
    }
  );
});

describe('langue absente ou inconnue', () => {
  it.each(['?lang=de', '', '?lang=', '?lang=FR', '?lang=fr-CH', '?langue=fr'])(
    '« %s » : 400 invalid_input, rien lu, rien écrit',
    async (query) => {
      const reponse = await appel('lic-01', query, COOKIES);

      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ok: false, reason: 'invalid_input'});
      expect(contenu.qaEntry).not.toHaveBeenCalled();
      expect(journal.touchSession).not.toHaveBeenCalled();
      expect(journal.addExchange).not.toHaveBeenCalled();
    }
  );
});

describe('entrée absente du corpus réel, ou non ordinaire', () => {
  it('répond 404 quand lʼentrée manque, et avertit une fois par processus', async () => {
    contenu.qaEntry.mockReturnValue(undefined);
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const premiere = await appel('wd-02', '?lang=fr', COOKIES);
    const seconde = await appel('wd-02', '?lang=fr', COOKIES);

    expect(premiere.status).toBe(404);
    expect(await premiere.json()).toEqual({ok: false, reason: 'content_unavailable'});
    expect(seconde.status).toBe(404);
    expect(avertit).toHaveBeenCalledTimes(1);
    const ligne = JSON.parse(avertit.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(ligne).toMatchObject({level: 'warn', event: 'questions.entry_unavailable', lang: 'fr', id: 'wd-02'});
    // Rien n'est écrit : ni session prolongée, ni échange.
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(journal.addExchange).not.toHaveBeenCalled();
    avertit.mockRestore();
  });

  it('avertit à nouveau pour une autre entrée, ou la même dans lʼautre langue', async () => {
    contenu.qaEntry.mockReturnValue(undefined);
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await appel('wd-02', '?lang=fr');
    await appel('wd-02', '?lang=en');
    await appel('site-02', '?lang=fr');
    await appel('site-02', '?lang=fr');

    expect(avertit).toHaveBeenCalledTimes(3);
    avertit.mockRestore();
  });

  it.each(['PRIVÉ', 'PASSE', 'vide'] as const)(
    'ne sert jamais une entrée %s : 404, aucun corps, rien écrit',
    async (statut) => {
      // Une entrée PRIVÉ n'a pas de `corps` ; le simulacre en met un pour
      // prouver que la route s'arrête au statut, sans le lire.
      contenu.qaEntry.mockReturnValue(entree('site-02', 'fr', {statut, corps: 'JAMAIS SERVI'}));
      const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const reponse = await appel('site-02', '?lang=fr', COOKIES);

      expect(reponse.status).toBe(404);
      const texte = await reponse.text();
      expect(texte).not.toContain('JAMAIS SERVI');
      expect(JSON.parse(texte)).toEqual({ok: false, reason: 'content_unavailable'});
      expect(avertit).toHaveBeenCalledTimes(1);
      expect(avertit.mock.calls[0]![0]).toContain(`"statut":"${statut}"`);
      expect(journal.touchSession).not.toHaveBeenCalled();
      expect(journal.addExchange).not.toHaveBeenCalled();
      avertit.mockRestore();
    }
  );

  it('ne sert pas une entrée ordinaire sans corps — impossible par le parseur, refusé quand même', async () => {
    contenu.qaEntry.mockReturnValue(entree('site-02', 'fr', {corps: undefined}));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await appel('site-02', '?lang=fr', COOKIES)).status).toBe(404);
    expect(journal.addExchange).not.toHaveBeenCalled();
  });
});

describe('ce que la route ne divulgue jamais', () => {
  it('ne sert ni la consigne ni le bloc dʼune entrée — seulement son corps', async () => {
    contenu.qaEntry.mockReturnValue(
      entree('lic-01', 'fr', {
        corps: 'Le corps, seul.',
        consigne: 'CONSIGNE-JAMAIS-SERVIE',
        bloc: {numero: 9, titre: 'BLOC-JAMAIS-SERVI'} as never
      })
    );

    const texte = await (await appel('lic-01', '?lang=fr', COOKIES)).text();

    expect(texte).toContain('Le corps, seul.');
    expect(texte).not.toContain('CONSIGNE-JAMAIS-SERVIE');
    expect(texte).not.toContain('BLOC-JAMAIS-SERVI');
  });

  it('refuse un corps blanc comme une entrée indisponible', async () => {
    contenu.qaEntry.mockReturnValue(entree('lic-01', 'fr', {corps: '   \n  '}));
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reponse = await appel('lic-01', '?lang=fr', COOKIES);

    expect(reponse.status).toBe(404);
    expect(await reponse.json()).toEqual({ok: false, reason: 'content_unavailable'});
    expect(journal.addExchange).not.toHaveBeenCalled();
    avertit.mockRestore();
  });
});

describe('le journal observe, il ne conditionne pas', () => {
  it('répond quand même si lʼinsertion de lʼéchange échoue, exchangeId null, et le dit', async () => {
    journal.addExchange.mockImplementation(() => {
      throw new Error('disque plein (simulé)');
    });
    const signale = vi.spyOn(console, 'error').mockImplementation(() => {});

    const reponse = await appel('lic-01', '?lang=fr', COOKIES);

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({answer: expect.any(String), exchangeId: null});
    expect(signale).toHaveBeenCalledTimes(1);
    const ligne = JSON.parse(signale.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(ligne.event).toBe('journal.write_failed');
    expect(ligne.reason).toContain('disque plein');
    signale.mockRestore();
  });

  it('répond quand même si la session ne peut pas être prolongée, sans insérer dʼéchange', async () => {
    journal.touchSession.mockImplementation(() => {
      throw new Error('base verrouillée (simulé)');
    });
    const signale = vi.spyOn(console, 'error').mockImplementation(() => {});

    const reponse = await appel('lic-01', '?lang=fr', COOKIES);

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).exchangeId).toBeNull();
    // Un échange sans session prolongée serait refusé par la clé étrangère : on n'essaie pas.
    expect(journal.addExchange).not.toHaveBeenCalled();
    signale.mockRestore();
  });

  it('nʼinsère pas dʼéchange sur une session présentée avec le cookie dʼun autre visiteur', async () => {
    journal.touchSession.mockReturnValue({outcome: 'mismatch', visitorCreated: false});

    const reponse = await appel('lic-01', '?lang=fr', COOKIES);

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).exchangeId).toBeNull();
    expect(journal.addExchange).not.toHaveBeenCalled();
  });

  it('sert la réponse avec exchangeId null quand la session a atteint sa borne dʼéchanges hero', async () => {
    // `addExchange` rend `null` au-delà de `HERO_EXCHANGES_PER_SESSION` (report de la story 5).
    journal.addExchange.mockReturnValue(null);

    const reponse = await appel('lic-01', '?lang=fr', COOKIES);

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({answer: expect.any(String), exchangeId: null});
    expect(journal.addExchange).toHaveBeenCalledTimes(1);
  });

  it('rattache lʼéchange à une session que la route vient de créer', async () => {
    journal.touchSession.mockReturnValue({outcome: 'created', visitorCreated: true});

    expect((await (await appel('lic-01', '?lang=fr', COOKIES)).json()).exchangeId).toBe(EXCHANGE_ID);
    expect(journal.addExchange).toHaveBeenCalledWith(expect.objectContaining({sessionId: SESSION_ID}));
  });
});

describe('aucun appel au modèle', () => {
  const ROOT = fileURLToPath(new URL('../../src', import.meta.url));

  function sources(directory: string, found: string[] = []): string[] {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) sources(path, found);
      else if (/\.tsx?$/.test(entry)) found.push(path);
    }
    return found;
  }

  it('ni `app` ni `journal` ne nomment lʼAPI du modèle — la route lit le contenu, et rien dʼautre', () => {
    const fautes = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'journal'))].filter((path) =>
      /anthropic/i.test(readFileSync(path, 'utf8'))
    );
    expect(fautes.map((path) => path.slice(ROOT.length))).toEqual([]);
  });

  it('la route nʼimporte que le contenu et le journal, à lʼappel', () => {
    const source = readFileSync(join(ROOT, 'app', 'api', 'questions', '[id]', 'route.ts'), 'utf8');
    expect(source).toContain("await import('@/content')");
    expect(source).toContain("await import('@/journal')");
    expect(source).not.toMatch(/from\s+['"]@\/(content|journal|agent|knowledge)['"]/);
    expect(source).not.toMatch(/@\/agent|@\/knowledge/);
  });
});
