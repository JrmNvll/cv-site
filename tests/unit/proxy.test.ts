/**
 * AD-14 / AD-10 — `proxy.ts` est le seul endroit qui pose les cookies, et
 * `/admin` échappe au routage de langue.
 *
 * Cas de la matrice couverts ici : visite sans cookie, session inactive de plus
 * de trente minutes, racine sans langue, `/admin` selon `ADMIN_DEV` et selon
 * l'environnement — et jamais un cookie sur `/admin*` (story 8 : l'admin ne se
 * journalise pas) —, non-mise en cache des réponses porteuses d'identité, et
 * périmètre réel du `matcher`.
 */
import {NextRequest, type NextResponse} from 'next/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ULID_PATTERN} from '@/lib/ulid';

const NOW = Date.parse('2026-09-08T10:00:00.000Z');
// ULID valides : l'alphabet de Crockford exclut I, L, O et U, et le premier
// caractère est borné à [0-7].
const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const SESSION_VALUE_PATTERN = new RegExp(`^${ULID_PATTERN.source.slice(1, -1)}\\.\\d+$`);
const savedEnv = {...process.env};

type ProxyModule = typeof import('@/proxy');

/** Recharge `proxy.ts` (et donc `env.ts`) avec l'environnement courant. */
async function loadProxy(
  overrides: {adminDev?: '0' | '1'; nodeEnv?: string} = {}
): Promise<ProxyModule> {
  vi.stubEnv('ADMIN_DEV', overrides.adminDev ?? '0');
  if (overrides.nodeEnv) {
    // `NODE_ENV` est en lecture seule côté types : `stubEnv` est la voie prévue.
    vi.stubEnv('NODE_ENV', overrides.nodeEnv as 'development' | 'production' | 'test');
  }
  vi.resetModules();
  return import('@/proxy');
}

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, 'http://127.0.0.1:3000'), {
    headers: cookie ? {cookie} : {}
  });
}

type ParsedCookie = {value: string; attributes: Record<string, string>};

function setCookies(response: NextResponse): Record<string, ParsedCookie> {
  const parsed: Record<string, ParsedCookie> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...rest] = raw.split(';');
    const separator = pair!.indexOf('=');
    const name = pair!.slice(0, separator);
    const attributes: Record<string, string> = {};
    for (const attribute of rest) {
      const [key, ...values] = attribute.trim().split('=');
      attributes[key!.toLowerCase()] = values.join('=');
    }
    parsed[name] = {value: decodeURIComponent(pair!.slice(separator + 1)), attributes};
  }
  return parsed;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  process.env = {...savedEnv};
  vi.resetModules();
});

describe('cookies de visite', () => {
  it('pose cv_visitor et cv_session quand le visiteur nʼa aucun cookie', async () => {
    const {
      default: proxy,
      VISITOR_COOKIE,
      SESSION_COOKIE,
      VISITOR_MAX_AGE_SECONDS
    } = await loadProxy();

    const cookies = setCookies(proxy(request('/fr')));

    expect(Object.keys(cookies).sort()).toEqual([SESSION_COOKIE, VISITOR_COOKIE].sort());
    expect(cookies[VISITOR_COOKIE]!.value).toMatch(ULID_PATTERN);
    expect(cookies[SESSION_COOKIE]!.value).toMatch(SESSION_VALUE_PATTERN);
    expect(cookies[SESSION_COOKIE]!.value.split('.')[1]).toBe(String(NOW));
    expect(cookies[VISITOR_COOKIE]!.attributes['max-age']).toBe(String(VISITOR_MAX_AGE_SECONDS));
    // Cookie de session : pas d'expiration, il meurt avec le navigateur.
    expect(cookies[SESSION_COOKIE]!.attributes['max-age']).toBeUndefined();
    expect(cookies[SESSION_COOKIE]!.attributes.expires).toBeUndefined();
  });

  it('pose les deux cookies en HttpOnly, Secure, SameSite=Lax', async () => {
    const {default: proxy, VISITOR_COOKIE, SESSION_COOKIE} = await loadProxy();

    const cookies = setCookies(proxy(request('/fr')));

    for (const name of [VISITOR_COOKIE, SESSION_COOKIE]) {
      const attributes = cookies[name]!.attributes;
      expect(attributes).toHaveProperty('httponly');
      expect(attributes).toHaveProperty('secure');
      expect(attributes.samesite?.toLowerCase()).toBe('lax');
      expect(attributes.path).toBe('/');
    }
  });

  it('conserve le visiteur et la session quand la session est encore active', async () => {
    const {default: proxy, VISITOR_COOKIE, SESSION_COOKIE, SESSION_IDLE_MS} = await loadProxy();

    const lastSeen = NOW - SESSION_IDLE_MS + 1000;
    const cookies = setCookies(
      proxy(
        request('/fr', {
          [VISITOR_COOKIE]: VISITOR_ID,
          [SESSION_COOKIE]: `${SESSION_ID}.${lastSeen}`
        })
      )
    );

    expect(cookies[VISITOR_COOKIE]!.value).toBe(VISITOR_ID);
    // Même session, horodatage de dernière activité rafraîchi.
    expect(cookies[SESSION_COOKIE]!.value).toBe(`${SESSION_ID}.${NOW}`);
  });

  it('ouvre une nouvelle session après trente minutes dʼinactivité, sans toucher au visiteur', async () => {
    const {default: proxy, VISITOR_COOKIE, SESSION_COOKIE, SESSION_IDLE_MS} = await loadProxy();

    const lastSeen = NOW - SESSION_IDLE_MS - 1;
    const cookies = setCookies(
      proxy(
        request('/fr', {
          [VISITOR_COOKIE]: VISITOR_ID,
          [SESSION_COOKIE]: `${SESSION_ID}.${lastSeen}`
        })
      )
    );

    expect(cookies[VISITOR_COOKIE]!.value).toBe(VISITOR_ID);
    expect(cookies[SESSION_COOKIE]!.value.split('.')[0]).toMatch(ULID_PATTERN);
    expect(cookies[SESSION_COOKIE]!.value.split('.')[0]).not.toBe(SESSION_ID);
    expect(cookies[SESSION_COOKIE]!.value.split('.')[1]).toBe(String(NOW));
  });

  it('remplace une valeur de cookie forgée par un identifiant neuf', async () => {
    const {default: proxy, VISITOR_COOKIE, SESSION_COOKIE} = await loadProxy();

    const cookies = setCookies(
      proxy(
        request('/fr', {
          [VISITOR_COOKIE]: 'pas-un-ulid',
          [SESSION_COOKIE]: 'pas-un-ulid.pas-un-nombre'
        })
      )
    );

    expect(cookies[VISITOR_COOKIE]!.value).toMatch(ULID_PATTERN);
    expect(cookies[SESSION_COOKIE]!.value).toMatch(SESSION_VALUE_PATTERN);
  });

  it('survit à une redirection : les cookies sont posés sur la réponse finale', async () => {
    const {default: proxy, VISITOR_COOKIE, SESSION_COOKIE} = await loadProxy();

    const response = proxy(request('/'));
    const cookies = setCookies(response);

    expect(response.headers.get('location')).toBeTruthy();
    expect(cookies[VISITOR_COOKIE]).toBeDefined();
    expect(cookies[SESSION_COOKIE]).toBeDefined();
  });
});

describe('mise en cache', () => {
  it.each(['/fr', '/'])(
    'interdit tout cache partagé sur %s, qui porte un identifiant de visiteur',
    async (path) => {
      const {default: proxy, CACHE_CONTROL_VISIT} = await loadProxy();

      const response = proxy(request(path));

      // Un cache amont qui retiendrait cette réponse resservirait l'identité du
      // visiteur précédent au suivant.
      expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL_VISIT);
      expect(CACHE_CONTROL_VISIT).toContain('private');
      expect(CACHE_CONTROL_VISIT).toContain('no-store');
    }
  );

  it.each(['/admin', '/admin/sessions/x', '/admin/api/adresses/203.0.113.7'])(
    'interdit aussi tout cache partagé sur %s, qui ne porte pourtant aucun cookie',
    async (path) => {
      const {default: proxy, CACHE_CONTROL_VISIT} = await loadProxy({adminDev: '1'});

      const response = proxy(request(path));

      expect(response.headers.getSetCookie()).toEqual([]);
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL_VISIT);
    }
  );
});

describe('nextSessionCookie', () => {
  it('produit une session neuve quand aucune valeur nʼest fournie', async () => {
    const {nextSessionCookie} = await loadProxy();
    const session = nextSessionCookie(undefined, NOW);

    expect(session.renewed).toBe(true);
    expect(session.value).toBe(`${session.sessionId}.${NOW}`);
  });

  it('reconduit une session récente', async () => {
    const {nextSessionCookie, SESSION_IDLE_MS} = await loadProxy();
    const session = nextSessionCookie(`${SESSION_ID}.${NOW - SESSION_IDLE_MS}`, NOW);

    expect(session.renewed).toBe(false);
    expect(session.sessionId).toBe(SESSION_ID);
  });

  it('refuse un horodatage situé dans le futur', async () => {
    const {nextSessionCookie} = await loadProxy();
    const session = nextSessionCookie(`${SESSION_ID}.${NOW + 1000}`, NOW);

    expect(session.renewed).toBe(true);
    expect(session.sessionId).not.toBe(SESSION_ID);
  });
});

describe('routage de langue', () => {
  it('redirige la racine sans langue vers /fr', async () => {
    const {default: proxy} = await loadProxy();

    const response = proxy(request('/'));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/fr');
  });

  it('sert /en sans redirection', async () => {
    const {default: proxy} = await loadProxy();

    const response = proxy(request('/en'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('/admin hors routage de langue', () => {
  it('ne préfixe jamais /admin dʼune langue quand ADMIN_DEV vaut 1', async () => {
    const {default: proxy} = await loadProxy({adminDev: '1'});

    const response = proxy(request('/admin'));

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('répond 404 sur /admin en développement quand ADMIN_DEV vaut 0', async () => {
    const {default: proxy} = await loadProxy({adminDev: '0', nodeEnv: 'development'});

    expect(proxy(request('/admin')).status).toBe(404);
    expect(proxy(request('/admin/sessions')).status).toBe(404);
  });

  it('sert /admin en production même sans ADMIN_DEV : Caddy le protège (AD-10)', async () => {
    // Sans ce test, remplacer `isAdminServed()` par `return env.ADMIN_DEV`
    // laisserait la suite verte et rendrait l'admin inatteignable en production.
    const {default: proxy} = await loadProxy({adminDev: '0', nodeEnv: 'production'});

    const response = proxy(request('/admin'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it.each([
    ['/admin', {adminDev: '1'} as const],
    ['/admin/sessions/01K4EXAMPSESS0000000000000', {adminDev: '1'} as const],
    ['/admin/api/visiteurs/01K4EXAMPVSTR0000000000000', {adminDev: '1'} as const],
    ['/admin', {adminDev: '0', nodeEnv: 'production'} as const],
    ['/admin', {adminDev: '0', nodeEnv: 'development'} as const]
  ])('ne pose aucun cookie de visite sur %s : lʼadmin ne se journalise pas', async (path, overrides) => {
    const {default: proxy} = await loadProxy(overrides);

    // Sans cookie déjà posé, comme avec : rien n'est posé ni reconduit.
    expect(proxy(request(path)).headers.getSetCookie()).toEqual([]);
    expect(
      proxy(
        request(path, {cv_visitor: VISITOR_ID, cv_session: `${SESSION_ID}.${NOW}`})
      ).headers.getSetCookie()
    ).toEqual([]);
  });

  it('continue de poser les cookies sur le site : seul lʼadmin en est exempt', async () => {
    const {default: proxy} = await loadProxy({adminDev: '1'});

    expect(proxy(request('/fr')).headers.getSetCookie().length).toBe(2);
    expect(proxy(request('/fr/administration')).headers.getSetCookie().length).toBe(2);
  });
});

describe('périmètre du matcher', () => {
  it('couvre les requêtes de document, et tout /admin* — même avec un point dans le chemin', async () => {
    const {config} = await loadProxy();
    // Deux motifs : le premier est une expression régulière, le second du
    // path-to-regexp (`:path*` : zéro segment ou plus).
    expect(config.matcher).toEqual(['/((?!api/|_next/|_vercel/|.*\\..*).*)', '/admin/:path*']);
    const document = new RegExp(`^${config.matcher[0]}$`);
    const admin = /^\/admin(?:\/.*)?$/;
    const couvert = (path: string) => document.test(path) || admin.test(path);

    for (const path of ['/', '/fr', '/en/x', '/admin', '/admin/sessions', '/admin/api/visiteurs/x', '/admin/api/adresses/2001:db8::1']) {
      expect(document.test(path), `${path} devrait être couvert par le motif des documents`).toBe(true);
    }
    // Un point dans le chemin : hors du premier motif, dans le second.
    for (const path of ['/admin/api/adresses/203.0.113.7', '/admin/x.y']) {
      expect(document.test(path), `${path} échappe au motif des documents`).toBe(false);
      expect(admin.test(path), `${path} devrait être couvert par /admin/:path*`).toBe(true);
      expect(couvert(path)).toBe(true);
    }

    for (const path of ['/api/ask', '/api/chat/stream', '/_next/static/x.js', '/photo.jpg', '/robots.txt']) {
      expect(couvert(path), `${path} devrait être exclu`).toBe(false);
    }
    // `/adminx` est un document ordinaire (premier motif), pas un chemin de l'admin.
    expect(admin.test('/adminx')).toBe(false);
  });

  it('ferme la porte sur une route de mutation à point, en développement sans ADMIN_DEV', async () => {
    const {default: proxy} = await loadProxy({adminDev: '0', nodeEnv: 'development'});
    const response = proxy(
      new NextRequest(new URL('/admin/api/adresses/203.0.113.7', 'http://127.0.0.1:3000'), {method: 'POST'})
    );
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('X-Client-IP-Seen (AD-15)', () => {
  /** Une requête de document, avec ou sans l'en-tête que Caddy pose. */
  function requete(path: string, clientIp?: string): NextRequest {
    return new NextRequest(new URL(path, 'http://127.0.0.1:3000'), {
      headers: clientIp === undefined ? {} : {'x-client-ip': clientIp}
    });
  }

  it('répond 1 quand la requête porte une adresse valide — IPv4 ou IPv6 —, sans jamais la répéter', async () => {
    const {default: proxy, CLIENT_IP_SEEN_HEADER} = await loadProxy();
    for (const adresse of ['203.0.113.7', '2001:db8::1', ' 203.0.113.7 ']) {
      const response = proxy(requete('/fr', adresse));
      expect(response.headers.get(CLIENT_IP_SEEN_HEADER), adresse).toBe('1');
      // Hors des en-têtes internes `x-middleware-*`, par lesquels Next relaie
      // les en-têtes de requête à la route et qu'il retire avant le client.
      const visibles = [...response.headers.entries()].filter(([name]) => !name.startsWith('x-middleware-'));
      expect(JSON.stringify(visibles)).not.toContain(adresse.trim());
    }
  });

  it('répond 0 sans en-tête, ou avec une valeur qui nʼest pas une adresse', async () => {
    const {default: proxy, CLIENT_IP_SEEN_HEADER} = await loadProxy();
    expect(proxy(requete('/fr')).headers.get(CLIENT_IP_SEEN_HEADER)).toBe('0');
    // Une liste « a, b » (Caddy qui ajouterait au lieu d'écraser), un nom, du vide.
    for (const valeur of ['203.0.113.7, 198.51.100.1', 'localhost', '', 'unknown']) {
      expect(proxy(requete('/fr', valeur)).headers.get(CLIENT_IP_SEEN_HEADER), JSON.stringify(valeur)).toBe('0');
    }
  });

  it('le pose aussi sur /admin — servi ou non — et sur une redirection', async () => {
    const production = await loadProxy({adminDev: '0', nodeEnv: 'production'});
    expect(production.default(requete('/admin', '203.0.113.7')).headers.get(production.CLIENT_IP_SEEN_HEADER)).toBe('1');
    const developpement = await loadProxy({adminDev: '0', nodeEnv: 'development'});
    const fermee = developpement.default(requete('/admin'));
    expect(fermee.status).toBe(404);
    expect(fermee.headers.get(developpement.CLIENT_IP_SEEN_HEADER)).toBe('0');
    // La racine redirige vers /fr : l'en-tête est sur la réponse finale, comme les cookies.
    const redirection = developpement.default(requete('/', '203.0.113.7'));
    expect(redirection.status).toBeGreaterThanOrEqual(300);
    expect(redirection.headers.get(developpement.CLIENT_IP_SEEN_HEADER)).toBe('1');
  });
});
