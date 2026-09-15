import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {expect, test, type APIRequestContext, type APIResponse} from '@playwright/test';
import en from '../../messages/en.json';

/**
 * Preuve navigateur du journal (AD-7, AD-14, AD-15), contre l'**artefact de
 * production** : ce qui est relu ici, c'est `tests/fixtures/data/usage.db`, la
 * base que le serveur lancé par Playwright vient d'écrire.
 *
 * Ce que le test unitaire ne peut pas prouver, et qui l'est ici :
 *  - les identifiants en base sont ceux des `Set-Cookie` **reçus** par le
 *    navigateur à la première visite — `proxy.ts` les pose sur la réponse, et
 *    le layout les lit dans la même requête ;
 *  - une visite sans question est visible ; une 404 aussi ;
 *  - `/api/contact/phone` prolonge avec les cookies et répond sans ;
 *  - en production, l'adresse vient de `X-Client-IP`, et de rien d'autre.
 *
 * La base persiste d'une exécution à l'autre et les autres fichiers de test
 * y écrivent en parallèle : on ne relit que ce qu'on vient d'écrire, jamais un
 * total. Chaque cas envoie un `User-Agent` qui lui est propre : c'est sa
 * signature dans la base.
 */
const USAGE_DB = resolve(__dirname, '../fixtures/data/usage.db');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type VisitorRow = {id: string; first_seen: string};
type SessionRow = {
  id: string;
  visitor_id: string;
  ip: string;
  user_agent: string | null;
  referer: string | null;
  lang: string;
  started_at: string;
  last_seen_at: string;
};

/** Une connexion en lecture seule, le temps d'une requête : toujours l'état commis. */
function lire<T>(sql: string, ...params: string[]): T | undefined {
  const db = new DatabaseSync(USAGE_DB, {readOnly: true});
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

const visitor = (id: string) => lire<VisitorRow>('SELECT id, first_seen FROM visitor WHERE id = ?', id);
const session = (id: string) =>
  lire<SessionRow>(
    'SELECT id, visitor_id, ip, user_agent, referer, lang, started_at, last_seen_at FROM session WHERE id = ?',
    id
  );
const sessionsOf = (visitorId: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM session WHERE visitor_id = ?', visitorId)!.n;
const sessionsSignees = (userAgent: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM session WHERE user_agent = ?', userAgent)!.n;

/** Les identifiants des `Set-Cookie` d'une réponse — ce que le navigateur reçoit. */
function idsRecus(response: APIResponse): {visitorId: string; sessionId: string} {
  const setCookies = response
    .headersArray()
    .filter(({name}) => name.toLowerCase() === 'set-cookie')
    .map(({value}) => value);
  const valeur = (nom: string) =>
    setCookies.find((cookie) => cookie.startsWith(`${nom}=`))?.split(';')[0]!.slice(nom.length + 1);
  const visitorId = valeur('cv_visitor');
  const sessionId = valeur('cv_session')?.split('.')[0];
  expect(visitorId, 'cv_visitor doit être posé').toMatch(ULID);
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return {visitorId: visitorId!, sessionId: sessionId!};
}

/** Les identifiants tels que le navigateur les tient — même lecture que `proxy.ts`. */
function idsDuContexte(cookies: {name: string; value: string}[]): {visitorId: string; sessionId: string} {
  const visitorId = cookies.find(({name}) => name === 'cv_visitor')?.value;
  const sessionId = cookies.find(({name}) => name === 'cv_session')?.value.split('.')[0];
  expect(visitorId, 'cv_visitor doit être posé').toMatch(ULID);
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return {visitorId: visitorId!, sessionId: sessionId!};
}

/** Une signature unique par cas : ce que la base retient comme `user_agent`. */
function signature(testInfo: {testId: string}): string {
  return `journal-spec/${testInfo.testId}`;
}

/** Une visite complète : la réponse est lue jusqu'au bout avant de relire la base. */
async function visiter(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>
): Promise<APIResponse> {
  const response = await request.get(path, {headers});
  await response.text();
  return response;
}

test('une première visite crée le visiteur et la session avec les identifiants des cookies reçus', async ({
  request
}, testInfo) => {
  const userAgent = signature(testInfo);
  const referer = 'https://exemple.invalid/offre-fictive';

  const response = await visiter(request, '/fr', {'user-agent': userAgent, referer});
  expect(response.status()).toBe(200);
  const {visitorId, sessionId} = idsRecus(response);

  const v = visitor(visitorId);
  expect(v, 'le visiteur des Set-Cookie doit être en base').toBeDefined();
  expect(v!.first_seen).toMatch(ISO_UTC);

  const s = session(sessionId);
  expect(s, 'la session des Set-Cookie doit être en base').toBeDefined();
  expect(s!.visitor_id).toBe(visitorId);
  expect(s!.lang).toBe('fr');
  expect(s!.user_agent).toBe(userAgent);
  expect(s!.referer).toBe(referer);
  expect(s!.started_at).toMatch(ISO_UTC);
  expect(s!.last_seen_at).toBe(s!.started_at);
});

test('la langue de la session est celle du document : /en', async ({request}, testInfo) => {
  const response = await visiter(request, '/en', {'user-agent': signature(testInfo)});

  expect(session(idsRecus(response).sessionId)!.lang).toBe('en');
});

/**
 * Les deux cas suivants passent par le **navigateur** : un cookie `Secure`
 * reçu sur `http://127.0.0.1` est renvoyé par Chromium (adresse locale de
 * confiance) mais pas par le contexte `request` de Playwright, qui ne fait
 * l'exception que pour `localhost`. C'est le navigateur qui compte.
 */
test('une seconde visite nʼajoute rien et fait avancer last_seen_at', async ({page, context}) => {
  const provenance = 'https://exemple.invalid/offre-fictive';
  await page.goto('/fr', {referer: provenance});
  const {visitorId, sessionId} = idsDuContexte(await context.cookies());
  const avant = session(sessionId)!;
  expect(avant.referer).toBe(provenance);

  await page.goto('/fr', {referer: 'https://autre.invalid/'});

  // Même visiteur, même session : le navigateur a renvoyé ses cookies.
  expect(idsDuContexte(await context.cookies())).toEqual({visitorId, sessionId});
  const apres = session(sessionId)!;
  expect(sessionsOf(visitorId)).toBe(1);
  expect(apres.last_seen_at > avant.last_seen_at).toBe(true);
  expect(apres.started_at).toBe(avant.started_at);
  // La provenance reste celle de la première apparition.
  expect(apres.referer).toBe(provenance);
});

test('une page inconnue est journalisée comme toute visite', async ({request}, testInfo) => {
  const userAgent = signature(testInfo);

  const response = await visiter(request, '/fr/chemin-inexistant', {'user-agent': userAgent});
  expect(response.status()).toBe(404);
  const {visitorId, sessionId} = idsRecus(response);

  expect(visitor(visitorId)).toBeDefined();
  expect(session(sessionId)?.user_agent).toBe(userAgent);
});

test('/api/contact/phone prolonge la session avec les cookies — le geste réel du visiteur', async ({
  page,
  context
}) => {
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  const {sessionId} = idsDuContexte(await context.cookies());

  // Entre la lecture d'« avant » et celle d'« après », seule la route doit
  // avoir parlé au serveur : aucun autre document (prefetch, favicon en 404)
  // ne peut être ce qui a fait avancer `last_seen_at`.
  const autresRequetes: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/contact/phone')) autresRequetes.push(request.url());
  });
  const avant = session(sessionId)!;

  // Le bouton du CV : c'est lui qui appelle la route, avec les cookies du navigateur.
  const appel = page.waitForResponse('**/api/contact/phone');
  await page.getByRole('button', {name: en.phone.reveal}).click();
  const response = await appel;
  const apres = session(sessionId)!;

  expect(response.status()).toBe(200);
  expect(autresRequetes).toEqual([]);
  expect(apres.last_seen_at > avant.last_seen_at).toBe(true);
  expect(apres.started_at).toBe(avant.started_at);
});

test('/api/contact/phone répond sans cookies, et nʼécrit rien', async ({playwright}, testInfo) => {
  // Un contexte neuf : aucun cookie, comme `curl`.
  const anonyme = await playwright.request.newContext({baseURL: testInfo.project.use.baseURL});
  const userAgent = signature(testInfo);

  const response = await visiter(anonyme, '/api/contact/phone', {'user-agent': userAgent});

  expect(response.status()).toBe(200);
  expect(await response.json()).toHaveProperty('telephone');
  // Les routes sont hors du proxy : aucun cookie n'est posé, aucune session créée.
  expect(response.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie')).toBe(false);
  expect(sessionsSignees(userAgent)).toBe(0);
  await anonyme.dispose();
});

test.describe('lʼadresse du client (AD-15), en production', () => {
  test('vient de X-Client-IP', async ({request}, testInfo) => {
    const response = await visiter(request, '/fr', {
      'user-agent': signature(testInfo),
      'x-client-ip': '203.0.113.7'
    });

    expect(session(idsRecus(response).sessionId)!.ip).toBe('203.0.113.7');
  });

  test('vaut « unknown » sans X-Client-IP, et X-Forwarded-For nʼest jamais lu', async ({
    request
  }, testInfo) => {
    const response = await visiter(request, '/fr', {
      'user-agent': signature(testInfo),
      'x-forwarded-for': '198.51.100.9'
    });

    expect(session(idsRecus(response).sessionId)!.ip).toBe('unknown');
  });
});
