/**
 * AD-14 côté `app` — le branchement entre les cookies posés par `proxy.ts` et
 * `journal.touchSession()`.
 *
 * Le journal est simulé : ce qui est prouvé ici, c'est ce que `app` lui passe
 * — et surtout quand elle ne l'appelle **pas**. Ligne de la matrice : « Requête
 * sans cookies sur une route → `touchSession` n'est pas appelé ».
 */
import {NextRequest} from 'next/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  HEADER_MAX,
  localeOfReferer,
  provenance,
  recordVisit,
  visitIds,
  type CookieReader
} from '@/app/_lib/visit';
import {SESSION_COOKIE, VISITOR_COOKIE} from '@/lib/visit-cookies';

const journal = vi.hoisted(() => ({touchSession: vi.fn()}));
vi.mock('@/journal', () => journal);

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';

function jar(cookies: Record<string, string>): CookieReader {
  return {get: (name) => (name in cookies ? {value: cookies[name]!} : undefined)};
}

beforeEach(() => {
  vi.resetAllMocks();
  journal.touchSession.mockReturnValue({outcome: 'created', visitorCreated: true});
});

describe('visitIds', () => {
  it('lit le visiteur et la partie avant le point de la session', () => {
    expect(
      visitIds(jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1757930400000`}))
    ).toEqual({visitorId: VISITOR_ID, sessionId: SESSION_ID});
  });

  it('rend null sans cookies, ou quand lʼun des deux manque', () => {
    expect(visitIds(jar({}))).toBeNull();
    expect(visitIds(jar({[VISITOR_COOKIE]: VISITOR_ID}))).toBeNull();
    expect(visitIds(jar({[SESSION_COOKIE]: `${SESSION_ID}.1757930400000`}))).toBeNull();
  });

  it('rend null quand une valeur nʼest pas un ULID : rien de forgé nʼatteint le journal', () => {
    expect(
      visitIds(jar({[VISITOR_COOKIE]: 'pas-un-ulid', [SESSION_COOKIE]: `${SESSION_ID}.1`}))
    ).toBeNull();
    expect(
      visitIds(jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: 'pas-un-ulid.1'}))
    ).toBeNull();
    expect(visitIds(jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: ''}))).toBeNull();
  });

  it('accepte les cookies dʼune vraie requête Next', () => {
    const request = new NextRequest('http://127.0.0.1:3000/api/contact/phone', {
      headers: {cookie: `${VISITOR_COOKIE}=${VISITOR_ID}; ${SESSION_COOKIE}=${SESSION_ID}.1757930400000`}
    });

    expect(visitIds(request.cookies)).toEqual({visitorId: VISITOR_ID, sessionId: SESSION_ID});
  });
});

describe('localeOfReferer', () => {
  const HOST = 'cv.exemple.invalid';

  it('lit le préfixe de langue de la page qui a émis lʼappel', () => {
    expect(localeOfReferer('http://127.0.0.1:3000/en', '127.0.0.1:3000')).toBe('en');
    expect(localeOfReferer(`https://${HOST}/fr?x=1`, HOST)).toBe('fr');
    expect(localeOfReferer(`https://${HOST}/en/quelque-chose`, HOST)).toBe('en');
  });

  it('retombe sur la langue par défaut sans provenance, ou hors des langues servies', () => {
    expect(localeOfReferer(null, HOST)).toBe('fr');
    expect(localeOfReferer('', HOST)).toBe('fr');
    expect(localeOfReferer('pas une url', HOST)).toBe('fr');
    expect(localeOfReferer(`https://${HOST}/`, HOST)).toBe('fr');
    expect(localeOfReferer(`https://${HOST}/de`, HOST)).toBe('fr');
    expect(localeOfReferer(`https://${HOST}/admin`, HOST)).toBe('fr');
  });

  it('ignore la provenance dʼun autre hôte : un site tiers ne dicte pas la langue', () => {
    expect(localeOfReferer('https://ailleurs.invalid/en', HOST)).toBe('fr');
    expect(localeOfReferer(`https://${HOST}/en`, null)).toBe('fr');
  });
});

describe('provenance', () => {
  it('garde lʼorigine et le chemin, jamais la chaîne de requête ni le fragment', () => {
    expect(provenance('https://offres.invalid/poste/42?utm=x&courriel=a@b.c#haut')).toBe(
      'https://offres.invalid/poste/42'
    );
  });

  it('borne ce qui nʼest pas une URL, et rend null pour rien', () => {
    expect(provenance(null)).toBeNull();
    expect(provenance('   ')).toBeNull();
    expect(provenance('pas une url')).toBe('pas une url');
    expect(provenance('x'.repeat(HEADER_MAX * 3))).toHaveLength(HEADER_MAX);
  });
});

describe('recordVisit', () => {
  const headers = new Headers({
    'user-agent': 'Navigateur/1.0 (test)',
    referer: 'https://exemple.invalid/offre'
  });

  it('passe au journal les identifiants, lʼadresse, le navigateur, la provenance et la langue', async () => {
    const result = await recordVisit({
      cookies: jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1757930400000`}),
      headers,
      lang: 'en'
    });

    expect(result).toEqual({outcome: 'created', visitorCreated: true});
    expect(journal.touchSession).toHaveBeenCalledTimes(1);
    expect(journal.touchSession).toHaveBeenCalledWith({
      visitorId: VISITOR_ID,
      sessionId: SESSION_ID,
      // Hors production : `clientIp` rend « dev », aucun en-tête n'est lu.
      ip: 'dev',
      userAgent: 'Navigateur/1.0 (test)',
      referer: 'https://exemple.invalid/offre',
      lang: 'en'
    });
  });

  it('borne le navigateur et réduit la provenance avant de les passer au journal', async () => {
    await recordVisit({
      cookies: jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1`}),
      headers: new Headers({
        'user-agent': 'N'.repeat(HEADER_MAX * 4),
        referer: 'https://offres.invalid/poste/42?jeton=secret'
      }),
      lang: 'fr'
    });

    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: 'N'.repeat(HEADER_MAX),
        referer: 'https://offres.invalid/poste/42'
      })
    );
  });

  it('sert la page quand le journal échoue : lʼerreur est dite, jamais propagée', async () => {
    // Le journal observe la visite, il ne la conditionne pas : disque plein,
    // base verrouillée, erreur d'E/S — la page part, une ligne le dit.
    journal.touchSession.mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordVisit({
        cookies: jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1`}),
        headers,
        lang: 'fr'
      })
    ).resolves.toBeNull();

    expect(erreur).toHaveBeenCalledTimes(1);
    expect(erreur.mock.calls[0]![0]).toContain('journal.write_failed');
    expect(erreur.mock.calls[0]![0]).toContain('SQLITE_BUSY');
    erreur.mockRestore();
  });

  it('passe null pour un navigateur ou une provenance absents', async () => {
    await recordVisit({
      cookies: jar({[VISITOR_COOKIE]: VISITOR_ID, [SESSION_COOKIE]: `${SESSION_ID}.1`}),
      headers: new Headers(),
      lang: 'fr'
    });

    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({userAgent: null, referer: null})
    );
  });

  it('nʼappelle rien sans cookies valides, et rend null', async () => {
    for (const cookies of [
      jar({}),
      jar({[VISITOR_COOKIE]: VISITOR_ID}),
      jar({[VISITOR_COOKIE]: 'pas-un-ulid', [SESSION_COOKIE]: `${SESSION_ID}.1`})
    ]) {
      expect(await recordVisit({cookies, headers, lang: 'fr'})).toBeNull();
    }
    expect(journal.touchSession).not.toHaveBeenCalled();
  });
});
