/**
 * Les deux gardes du blocage, exécutés — `requireNotBlocked()` pour les
 * documents et `requestBlocked()` pour les routes (story 13).
 *
 * `tests/unit/blocage-pages.test.ts` lit les sources en texte : il attrape une
 * page ou une route qui oublierait l'appel, mais il ne prouve rien de ce que
 * ces fonctions **font**. Ce qui est éprouvé ici, et nulle part ailleurs :
 *
 *  - le repli : un registre illisible laisse passer, il ne ferme pas le site.
 *    C'est l'arbitrage le plus lourd du dispositif (AD-14), et l'inverser —
 *    `notFound()` dans le `try`, ou une levée dans le `catch` — fermerait le
 *    CV entier dès qu'une sauvegarde verrouille la base ;
 *  - le cookie absent : `recordVisit()` rend `null` sans cookies, et tester
 *    `visit?.blocked` donnait `undefined`. Il suffisait d'effacer ses cookies
 *    pour récupérer les réponses du premier écran, la photo et le numéro de
 *    téléphone. Trouvé par la revue de la story 13 ;
 *  - le test de fumée, qui sort avant tout verdict dans les deux fonctions.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {cookieReaderOf, requestBlocked, requireNotBlocked} from '@/app/_lib/visit';
import {SESSION_COOKIE, VISITOR_COOKIE} from '@/lib/visit-cookies';

const journal = vi.hoisted(() => ({
  blockVerdict: vi.fn(),
  isBlocked: (verdict: {byIp: boolean; byVisitor: boolean}) => verdict.byIp || verdict.byVisitor
}));
vi.mock('@/journal', () => journal);

const nextHeaders = vi.hoisted(() => ({cookies: vi.fn(), headers: vi.fn()}));
vi.mock('next/headers', () => nextHeaders);

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
}));
vi.mock('next/navigation', () => navigation);

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const COOKIE = `${VISITOR_COOKIE}=${VISITOR_ID}; ${SESSION_COOKIE}=${SESSION_ID}.1757930400000`;

/** Ce que `cookies()` de `next/headers` rend, en plus simple. */
function jar(cookies: Record<string, string>) {
  return {get: (name: string) => (name in cookies ? {value: cookies[name]!} : undefined)};
}

function poserRequete(cookies: Record<string, string>, userAgent = 'Mozilla/5.0'): void {
  nextHeaders.cookies.mockResolvedValue(jar(cookies));
  nextHeaders.headers.mockResolvedValue(new Headers({'user-agent': userAgent}));
}

beforeEach(() => {
  vi.resetAllMocks();
  navigation.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  journal.blockVerdict.mockReturnValue({byIp: false, byVisitor: false});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requireNotBlocked — le garde des documents', () => {
  const avecCookies = {[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1`};

  it('laisse passer une visite libre, sans rien lever', async () => {
    poserRequete(avecCookies);

    await expect(requireNotBlocked()).resolves.toBeUndefined();

    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  it('lève la page des adresses inconnues pour un bloqué', async () => {
    poserRequete(avecCookies);
    journal.blockVerdict.mockReturnValue({byIp: false, byVisitor: true});

    await expect(requireNotBlocked()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('consulte lʼadresse **seule** quand la requête nʼa pas de cookie', async () => {
    poserRequete({});
    journal.blockVerdict.mockReturnValue({byIp: true, byVisitor: false});

    await expect(requireNotBlocked()).rejects.toThrow('NEXT_NOT_FOUND');

    // Le visiteur vaut `null`, et la clause du cookie est omise côté journal :
    // ne rien consulter rouvrirait la porte à qui refuse les cookies.
    expect(journal.blockVerdict).toHaveBeenCalledWith({ip: 'dev', visitorId: null});
  });

  it('sert la page quand le registre est illisible — le refus nʼest pas le défaut', async () => {
    poserRequete(avecCookies);
    journal.blockVerdict.mockImplementation(() => {
      throw new Error('base verrouillée');
    });

    await expect(requireNotBlocked()).resolves.toBeUndefined();

    expect(navigation.notFound).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('ne consulte rien pour le test de fumée : un déploiement ne se ferme pas tout seul', async () => {
    poserRequete(avecCookies, 'cv-site-smoke/1.0.0');
    journal.blockVerdict.mockReturnValue({byIp: true, byVisitor: true});

    await expect(requireNotBlocked()).resolves.toBeUndefined();

    expect(journal.blockVerdict).not.toHaveBeenCalled();
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

describe('requestBlocked — le garde des routes', () => {
  const requete = (cookie?: string, userAgent = 'Mozilla/5.0') => ({
    headers: new Headers(cookie === undefined ? {'user-agent': userAgent} : {'user-agent': userAgent, cookie})
  });

  it('rend le verdict déjà calculé quand recordVisit a parlé — sans réinterroger', async () => {
    const visite = {blocked: true} as never;

    expect(await requestBlocked(requete(COOKIE), visite)).toBe(true);

    expect(journal.blockVerdict).not.toHaveBeenCalled();
  });

  it('interroge lʼadresse quand recordVisit a rendu null — le cookie effacé ne rouvre rien', async () => {
    journal.blockVerdict.mockReturnValue({byIp: true, byVisitor: false});

    expect(await requestBlocked(requete(), null)).toBe(true);

    expect(journal.blockVerdict).toHaveBeenCalledWith({ip: 'dev', visitorId: null});
  });

  it('lit le cookie dans lʼen-tête quand lʼappelant nʼa quʼun Request nu (/api/photo)', async () => {
    journal.blockVerdict.mockReturnValue({byIp: false, byVisitor: true});

    expect(await requestBlocked(requete(COOKIE), null)).toBe(true);

    expect(journal.blockVerdict).toHaveBeenCalledWith({ip: 'dev', visitorId: VISITOR_ID});
  });

  it('laisse passer quand le registre est illisible, et le dit', async () => {
    journal.blockVerdict.mockImplementation(() => {
      throw new Error('base verrouillée');
    });

    expect(await requestBlocked(requete(COOKIE), null)).toBe(false);

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('ne consulte rien pour le test de fumée', async () => {
    journal.blockVerdict.mockReturnValue({byIp: true, byVisitor: true});

    expect(await requestBlocked(requete(COOKIE, 'cv-site-smoke/1.0.0'), null)).toBe(false);

    expect(journal.blockVerdict).not.toHaveBeenCalled();
  });
});

describe('cookieReaderOf', () => {
  it('lit les cookies dʼun en-tête, et rend undefined pour le reste', () => {
    const lecteur = cookieReaderOf(new Headers({cookie: COOKIE}));

    expect(lecteur.get(VISITOR_COOKIE)).toEqual({value: VISITOR_ID});
    expect(lecteur.get(SESSION_COOKIE)).toEqual({value: `${SESSION_ID}.1757930400000`});
    expect(lecteur.get('cv_inconnu')).toBeUndefined();
  });

  it('tolère un en-tête absent, vide, ou mal formé — sans lever', () => {
    for (const valeur of ['', '   ', 'sans-egal', '=orphelin', ';;;', 'a=1;;b=2']) {
      const lecteur = cookieReaderOf(new Headers(valeur === '' ? {} : {cookie: valeur}));
      expect(lecteur.get(VISITOR_COOKIE), valeur).toBeUndefined();
    }
    expect(cookieReaderOf(new Headers({cookie: 'a=1;;b=2'})).get('b')).toEqual({value: '2'});
  });

  it('garde la première valeur dʼune clé en double, comme un navigateur', () => {
    const lecteur = cookieReaderOf(new Headers({cookie: `${VISITOR_COOKIE}=premier; ${VISITOR_COOKIE}=second`}));

    expect(lecteur.get(VISITOR_COOKIE)).toEqual({value: 'premier'});
  });
});
