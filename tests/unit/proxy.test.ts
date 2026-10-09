/**
 * AD-14 / AD-10 — `proxy.ts` est le seul endroit qui pose les cookies, et
 * `/admin` échappe au routage de langue.
 *
 * Cas de la matrice couverts ici : visite sans cookie, session inactive de plus
 * de trente minutes, racine sans langue, `/admin` selon `ADMIN_DEV` et selon
 * l'environnement — et jamais un cookie sur `/admin*` (story 8 : l'admin ne se
 * journalise pas) —, non-mise en cache des réponses porteuses d'identité,
 * périmètre réel du `matcher`, et l'étiquette de lien `?l=` (story 12) :
 * valeur acceptée ou refusée, redirection qui la retire, cookie relais posé
 * puis effacé, et `/admin` qui n'en consomme rien.
 */
import {readFileSync} from 'node:fs';
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

describe('lʼétiquette dʼun lien (story 12)', () => {
  /** Les valeurs de test ne désignent personne : elles n'ont aucun référent. */
  const LIBELLE = 'a7f3';

  it('redirige vers lʼadresse sans ?l=, en 302, et pose les trois cookies', async () => {
    const {
      default: proxy,
      LABEL_COOKIE,
      LABEL_REDIRECT_STATUS,
      SESSION_COOKIE,
      VISITOR_COOKIE,
      CACHE_CONTROL_VISIT
    } = await loadProxy();

    const response = proxy(request(`/fr?l=${LIBELLE}`));

    expect(response.status).toBe(LABEL_REDIRECT_STATUS);
    expect(LABEL_REDIRECT_STATUS).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/fr');
    expect(location.search).toBe('');
    const cookies = setCookies(response);
    expect(Object.keys(cookies).sort()).toEqual([LABEL_COOKIE, SESSION_COOKIE, VISITOR_COOKIE].sort());
    expect(cookies[LABEL_COOKIE]!.value).toBe(LIBELLE);
    // Le relais ne survit pas à la fermeture du navigateur, et reste à nous.
    const attributs = cookies[LABEL_COOKIE]!.attributes;
    expect(attributs).toHaveProperty('httponly');
    expect(attributs).toHaveProperty('secure');
    expect(attributs.samesite?.toLowerCase()).toBe('lax');
    expect(attributs.path).toBe('/');
    expect(attributs['max-age']).toBeUndefined();
    expect(attributs.expires).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL_VISIT);
  });

  it('conserve les autres paramètres de lʼadresse', async () => {
    const {default: proxy} = await loadProxy();

    const response = proxy(request(`/fr?l=${LIBELLE}&utm_source=mail`));

    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/fr');
    expect(location.searchParams.get('utm_source')).toBe('mail');
    expect(location.searchParams.has('l')).toBe(false);
  });

  it('consomme le paramètre **et** route la langue : une seule adresse propre, /fr', async () => {
    const {default: proxy, LABEL_COOKIE, LABEL_REDIRECT_STATUS} = await loadProxy();

    const response = proxy(request(`/?l=${LIBELLE}`));

    // Un seul saut : pas `/` puis `/fr`, directement `/fr`.
    expect(response.status).toBe(LABEL_REDIRECT_STATUS);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/fr');
    expect(location.search).toBe('');
    expect(setCookies(response)[LABEL_COOKIE]!.value).toBe(LIBELLE);
  });

  it.each([
    ['', 'vide'],
    ['x'.repeat(33), '33 caractères'],
    ['a b', 'une espace'],
    ['a/c', 'une barre oblique'],
    ['a.b', 'un point'],
    ['<script>', 'du balisage'],
    ['étiquette', 'un accent']
  ])('ignore en silence la valeur %j (%s) : aucun cookie, aucune redirection', async (valeur) => {
    const {default: proxy, LABEL_COOKIE} = await loadProxy();

    const response = proxy(
      new NextRequest(new URL(`/fr?l=${encodeURIComponent(valeur)}`, 'http://127.0.0.1:3000'))
    );

    // La page est servie normalement — les deux cookies de visite seulement.
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(setCookies(response)[LABEL_COOKIE]).toBeUndefined();
  });

  it('accepte la borne : 32 caractères du jeu autorisé', async () => {
    const {default: proxy, LABEL_COOKIE} = await loadProxy();
    const limite = `${'a-9_'.repeat(7)}abcd`;
    expect(limite).toHaveLength(32);

    const response = proxy(request(`/fr?l=${limite}`));

    expect(response.status).toBe(302);
    expect(setCookies(response)[LABEL_COOKIE]!.value).toBe(limite);
  });

  it('efface le cookie relais sur la réponse qui suit : une étiquette ne contamine pas la visite dʼaprès', async () => {
    const {default: proxy, LABEL_COOKIE} = await loadProxy();

    const response = proxy(
      request('/fr', {
        [LABEL_COOKIE]: LIBELLE,
        cv_visitor: VISITOR_ID,
        cv_session: `${SESSION_ID}.${NOW}`
      })
    );

    const cookie = setCookies(response)[LABEL_COOKIE]!;
    expect(cookie.value).toBe('');
    expect(cookie.attributes['max-age']).toBe('0');
    expect(cookie.attributes.path).toBe('/');
  });

  it('ne touche pas au cookie relais quand la requête nʼen porte pas', async () => {
    const {default: proxy, LABEL_COOKIE} = await loadProxy();

    expect(setCookies(proxy(request('/fr')))[LABEL_COOKIE]).toBeUndefined();
  });

  it('repose le relais, sans lʼeffacer, quand une arrivée étiquetée en porte déjà un', async () => {
    const {default: proxy, LABEL_COOKIE} = await loadProxy();

    const response = proxy(request('/fr?l=zz9', {[LABEL_COOKIE]: LIBELLE}));

    const cookies = response.headers.getSetCookie().filter((raw) => raw.startsWith(`${LABEL_COOKIE}=`));
    expect(cookies).toHaveLength(1);
    expect(setCookies(response)[LABEL_COOKIE]!.value).toBe('zz9');
  });

  it.each(['/admin', '/admin/sessions'])(
    'ne consomme rien sur %s : ni cookie, ni redirection — lʼadmin ne se journalise pas',
    async (path) => {
      const {default: proxy, LABEL_COOKIE} = await loadProxy({adminDev: '1'});

      const response = proxy(request(`${path}?l=${LIBELLE}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(setCookies(response)[LABEL_COOKIE]).toBeUndefined();
    }
  );

  it.each(['/admin', '/admin/sessions/01K4EXAMPSESS0000000000000'])(
    'efface quand même le relais sur %s, et rien dʼautre',
    async (path) => {
      const {default: proxy, LABEL_COOKIE} = await loadProxy({adminDev: '1'});

      // Le propriétaire est précisément celui qui clique ses propres liens puis
      // va voir l'admin : un relais qui survivrait à ce détour étiquetterait
      // une visite ultérieure sans rapport.
      const cookies = setCookies(proxy(request(path, {[LABEL_COOKIE]: LIBELLE})));

      expect(Object.keys(cookies)).toEqual([LABEL_COOKIE]);
      expect(cookies[LABEL_COOKIE]!.value).toBe('');
      expect(cookies[LABEL_COOKIE]!.attributes['max-age']).toBe('0');
    }
  );

  it.each(['POST', 'PUT', 'DELETE'])(
    'ignore ?l= sur une requête %s : un 302 dégraderait la méthode et perdrait le corps',
    async (method) => {
      const {default: proxy, LABEL_COOKIE} = await loadProxy();

      const response = proxy(
        new NextRequest(new URL(`/fr?l=${LIBELLE}`, 'http://127.0.0.1:3000'), {method})
      );

      expect(response.headers.get('location')).toBeNull();
      expect(setCookies(response)[LABEL_COOKIE]).toBeUndefined();
    }
  );

  it('consomme ?l= sur une requête HEAD, comme sur un GET', async () => {
    const {default: proxy, LABEL_COOKIE, LABEL_REDIRECT_STATUS} = await loadProxy();

    const response = proxy(
      new NextRequest(new URL(`/fr?l=${LIBELLE}`, 'http://127.0.0.1:3000'), {method: 'HEAD'})
    );

    expect(response.status).toBe(LABEL_REDIRECT_STATUS);
    expect(setCookies(response)[LABEL_COOKIE]!.value).toBe(LIBELLE);
  });

  it('tient la dépendance au routage de langue : ni cookie de langue, ni négociation', async () => {
    // `labelRedirect` ne garde de la réponse du routage que son `Location` :
    // tout ce que next-intl poserait d'autre serait perdu. C'est sans
    // conséquence tant que ces deux options valent `false` — si l'une passait à
    // `true`, il faudrait repartir de la réponse du routage au lieu de la
    // reconstruire. Ce test est là pour que ce changement ne passe pas seul.
    const {routing} = await import('@/i18n/routing');
    expect(routing.localeCookie).toBe(false);
    expect(routing.localeDetection).toBe(false);

    // Et le comportement qui en dépend : une arrivée étiquetée sur la racine ne
    // pose que les trois cookies attendus.
    const {default: proxy, LABEL_COOKIE, SESSION_COOKIE, VISITOR_COOKIE} = await loadProxy();
    const cookies = setCookies(proxy(request(`/?l=${LIBELLE}`)));
    expect(Object.keys(cookies).sort()).toEqual(
      [LABEL_COOKIE, SESSION_COOKIE, VISITOR_COOKIE].sort()
    );
  });

  it('nʼouvre jamais la base : le relais passe par le cookie, pas par le journal', async () => {
    // AD-14 : `proxy.ts` ne doit pas pouvoir atteindre la couche `journal` —
    // `layers.config.mjs` le tient, et le dire ici le rend visible du lecteur
    // qui se demande pourquoi l'étiquette fait ce détour.
    const source = readFileSync(new URL('../../src/proxy.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/@\/journal/);
    expect(source).not.toMatch(/node:sqlite/);
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
