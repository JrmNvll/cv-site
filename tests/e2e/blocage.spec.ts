import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {expect, test, type APIRequestContext, type APIResponse} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * Preuve navigateur du blocage d'un visiteur (story 13), contre l'**artefact de
 * production** : ce qui est relu ici, c'est `tests/fixtures/data/usage.db`, la
 * base que le serveur lancé par Playwright vient d'écrire.
 *
 * Ce que le test unitaire ne peut pas prouver, et qui l'est ici :
 *  - un bloqué reçoit un `404` **de la même forme** que celui d'une sonde à un
 *    segment (`/wp-login.php`), mesurée ici contre ce témoin et non contre une
 *    idée de ce qu'elle devrait être : avec JavaScript, la page « Page
 *    introuvable » s'affiche ; **sans** JavaScript, le corps n'est pas rendu —
 *    le texte voyage dans le flux RSC, enfermé dans un `<script>`, et aucune
 *    balise du document n'est servie. C'est le comportement d'un `notFound()`
 *    levé pendant le rendu (`src/app/global-not-found.tsx` l'explique), arbitré
 *    par Jérémie le 2026-10-17 : la page blanche est acceptée, parce qu'elle est
 *    exactement ce que le site rend déjà à `/wp-login.php` ;
 *  - rien du CV n'est rendu : avec script, le seul `main` est celui de la 404 ;
 *  - l'assistant et les deux autres routes se ferment aussi — c'est là que le
 *    blocage protège la dépense ;
 *  - une levée depuis l'admin rouvre le site, et une clé à la fois.
 *
 * `playwright.config.ts` efface `usage.db` au démarrage de chaque exécution,
 * mais les autres fichiers de test y écrivent **en parallèle** : chaque cas a
 * son adresse (`198.51.x`, hors des `203.0.x` des autres fichiers) et son agent
 * utilisateur, et on ne relit que ce qu'on vient d'écrire — jamais un total.
 */
const USAGE_DB = resolve(__dirname, '../fixtures/data/usage.db');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function lire<T>(sql: string, ...params: string[]): T | undefined {
  const db = new DatabaseSync(USAGE_DB, {readOnly: true});
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

const blocagesDe = (value: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM block WHERE value = ? AND lifted_at IS NULL', value)!.n;
const echangesDe = (sessionId: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM exchange WHERE session_id = ?', sessionId)!.n;
const sessionsSignees = (userAgent: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM session WHERE user_agent = ?', userAgent)!.n;

/** Les identifiants des `Set-Cookie` reçus — ce que le navigateur tient. */
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

/** Une adresse propre à ce cas : les fichiers de test tournent en parallèle. */
function adresse(testInfo: {parallelIndex: number; workerIndex: number}, decalage = 0): string {
  return `198.51.${(testInfo.parallelIndex + 10 + decalage) % 250}.${(testInfo.workerIndex % 200) + 1}`;
}

async function visiter(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>
): Promise<APIResponse> {
  const response = await request.get(path, {headers});
  await response.text();
  return response;
}

/** Bloque l'auteur d'une session par le formulaire de l'admin — le geste réel. */
async function bloquer(request: APIRequestContext, sessionId: string): Promise<void> {
  const response = await request.post(`/admin/api/blocages/${sessionId}`, {
    headers: {'sec-fetch-site': 'same-origin'},
    form: {from: `/admin/sessions/${sessionId}`},
    maxRedirects: 0
  });
  expect(response.status(), await response.text()).toBe(303);
}

/** Lève une clé — une seule, par le formulaire de l'admin. */
async function lever(request: APIRequestContext, kind: 'ip' | 'visitor', value: string): Promise<void> {
  const response = await request.post('/admin/api/blocages/lever', {
    headers: {'sec-fetch-site': 'same-origin'},
    form: {kind, value, from: '/admin/blocages'},
    maxRedirects: 0
  });
  expect(response.status(), await response.text()).toBe(303);
}

test('un bloqué reçoit un 404 de la même forme quʼune sonde à un segment, script ou pas', async ({
  browser,
  request
}, testInfo) => {
  const ip = adresse(testInfo);
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const entetes = {'user-agent': userAgent, 'x-client-ip': ip};
  const {visitorId, sessionId} = idsRecus(await visiter(request, '/fr', entetes));

  await bloquer(request, sessionId);
  expect(blocagesDe(visitorId)).toBe(1);

  const cookie = `cv_visitor=${visitorId}; cv_session=${sessionId}.${Date.now()}`;

  // 1. Le HTML tel que le serveur l'envoie — ce qu'un visiteur sans
  //    JavaScript, ou un outil, reçoit vraiment. Le corps de la 404 doit y
  //    être : c'est l'exigence de la story, et elle ne se voit qu'ici.
  const temoin = await visiter(request, '/wp-login.php', entetes);
  const htmlTemoin = await temoin.text();
  const pages = [
    ['/fr', fr.notFound.heading],
    ['/fr/comment', fr.notFound.heading],
    ['/fr/mentions', fr.notFound.heading],
    // La 404 d'un bloqué parle sa langue, comme toute 404 du site.
    ['/en', en.notFound.heading]
  ] as const;
  for (const [chemin, titre] of pages) {
    const response = await request.get(chemin, {headers: {...entetes, cookie}});
    const html = await response.text();

    expect(response.status(), chemin).toBe(temoin.status());
    expect(response.status(), chemin).toBe(404);
    expect(html, chemin).toContain(titre);
    // La même enveloppe que la sonde à un segment : rien ne distingue les deux.
    expect(html.includes('__next_error__'), chemin).toBe(htmlTemoin.includes('__next_error__'));
  }

  // 2. Ce que l'œil voit, comparé au témoin — **la même chose**, dans les deux
  //    réglages. Chaque assertion porte sur le DOM rendu : le texte brut
  //    contiendrait le flux RSC, où tous les libellés du site voyagent.
  for (const javaScriptEnabled of [true, false]) {
    const contexte = await browser.newContext({
      javaScriptEnabled,
      userAgent,
      extraHTTPHeaders: {'x-client-ip': ip}
    });
    await contexte.addCookies([
      {name: 'cv_visitor', value: visitorId, domain: '127.0.0.1', path: '/'},
      {name: 'cv_session', value: `${sessionId}.${Date.now()}`, domain: '127.0.0.1', path: '/'}
    ]);
    const page = await contexte.newPage();

    const vuBloque = await page.goto('/fr');
    const mainsBloque = await page.locator('main').count();
    // Compter d'abord : lire le texte d'un élément absent attendrait le
    // délai complet du test, et sans script il est absent.
    const h1 = page.locator('h1');
    const titreBloque = (await h1.count()) > 0 ? await h1.first().textContent() : null;
    // Le CV n'est jamais rendu, dans aucun réglage.
    await expect(page.getByRole('region', {name: fr.assistant.eyebrow})).toHaveCount(0);

    const vuTemoin = await page.goto('/wp-login.php');
    const mainsTemoin = await page.locator('main').count();

    expect(vuBloque!.status(), `javascript=${javaScriptEnabled}`).toBe(404);
    expect(vuBloque!.status()).toBe(vuTemoin!.status());
    // La forme servie est celle du témoin : avec script, le corps s'affiche ;
    // sans script, ni l'un ni l'autre ne rend quoi que ce soit.
    expect(mainsBloque, `javascript=${javaScriptEnabled}`).toBe(mainsTemoin);
    expect(mainsBloque).toBe(javaScriptEnabled ? 1 : 0);
    expect(titreBloque).toBe(javaScriptEnabled ? fr.notFound.heading : null);

    await contexte.close();
  }
});

test('un bloqué nʼatteint plus lʼassistant : les quatre routes répondent 404, sans échange ni dépense', async ({
  request
}, testInfo) => {
  const ip = adresse(testInfo, 50);
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const entetes = {'user-agent': userAgent, 'x-client-ip': ip};
  const {visitorId, sessionId} = idsRecus(await visiter(request, '/fr', entetes));
  const cookie = `cv_visitor=${visitorId}; cv_session=${sessionId}.${Date.now()}`;

  await bloquer(request, sessionId);

  // La puce du premier écran — gratuite, mais fermée elle aussi.
  const puce = await request.get('/api/questions/lic-01?lang=fr', {headers: {...entetes, cookie}});
  expect(puce.status()).toBe(404);
  expect(await puce.text()).toBe('');

  // La question libre : refusée **avant** toute réservation de dépense.
  const chat = await request.post('/api/chat', {
    headers: {...entetes, cookie, 'content-type': 'application/json'},
    data: {question: 'Quel est son parcours ?', lang: 'fr'}
  });
  expect(chat.status()).toBe(404);
  expect(await chat.text()).toBe('');

  // L'annonce aussi.
  const match = await request.post('/api/match', {
    headers: {...entetes, cookie, 'content-type': 'application/json'},
    // Le champ s'appelle 'ad' (chat-contract.ts) : 'annonce' vaudrait 400, et
    // le test aurait prouvé la validation du corps, pas le blocage.
    data: {ad: 'Poste fictif, dix ans demandés, disponibilité immédiate.', lang: 'fr'}
  });
  expect(match.status()).toBe(404);

  // Et les coordonnées.
  const contact = await request.get('/api/contact/phone', {headers: {...entetes, cookie}});
  expect(contact.status()).toBe(404);

  // La photo aussi : c'est une donnée personnelle, et l'adresse de la route est
  // connue de quiconque a vu la page une fois.
  const photo = await request.get('/api/photo?s=2', {headers: {...entetes, cookie}});
  expect(photo.status()).toBe(404);

  // Aucun échange n'a été écrit pour cette session : rien n'a coûté.
  expect(echangesDe(sessionId)).toBe(0);

  // **Sans cookie du tout**, depuis la même adresse : les quatre routes restent
  // fermées. C'est l'adresse qui retient, et c'était le trou que la revue de la
  // story 13 a trouvé — `recordVisit` rend `null` sans cookie, et le test de
  // `visit?.blocked` valait alors `undefined` : il suffisait d'effacer ses
  // cookies pour récupérer les réponses, le portrait et le numéro.
  const sansCookie = {'user-agent': `${userAgent}-nu`, 'x-client-ip': ip};
  expect((await request.get('/api/questions/lic-01?lang=fr', {headers: sansCookie})).status()).toBe(404);
  expect((await request.get('/api/contact/phone', {headers: sansCookie})).status()).toBe(404);
  expect((await request.get('/api/photo?s=2', {headers: sansCookie})).status()).toBe(404);
  // L'assistant, lui, répond `401 no_visitor` sans cookie — avant même le
  // verdict, et pour **tout le monde** : il exige une session. Rien n'est servi
  // ni réservé, et la réponse ne distingue donc pas un bloqué d'un autre.
  const chatNu = await request.post('/api/chat', {
    headers: {...sansCookie, 'content-type': 'application/json'},
    data: {question: 'Quel est son parcours ?', lang: 'fr'}
  });
  expect(chatNu.status()).toBe(401);
  expect(await chatNu.json()).toMatchObject({ok: false, reason: 'no_visitor'});

  // Le refus ne se met pas en cache : il serait resservi après une levée, ou à
  // un visiteur qui n'a rien demandé.
  expect(photo.headers()['cache-control']).toBe('private, no-store');
});

test('une levée rouvre une clé à la fois : lʼadresse rendue, le cookie encore fermé', async ({request}, testInfo) => {
  const ip = adresse(testInfo, 100);
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const {visitorId, sessionId} = idsRecus(await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip}));
  const cookie = `cv_visitor=${visitorId}; cv_session=${sessionId}.${Date.now()}`;

  await bloquer(request, sessionId);
  expect(blocagesDe(ip)).toBe(1);
  expect(blocagesDe(visitorId)).toBe(1);

  // Un voisin de la même adresse, sans ces cookies : pris par l'adresse.
  const voisin = await visiter(request, '/fr', {'user-agent': `${userAgent}-voisin`, 'x-client-ip': ip});
  expect(voisin.status()).toBe(404);

  await lever(request, 'ip', ip);

  // Le voisin retrouve le site…
  const voisinRendu = await visiter(request, '/fr', {'user-agent': `${userAgent}-voisin`, 'x-client-ip': ip});
  expect(voisinRendu.status()).toBe(200);
  // …mais le visiteur bloqué, non : son cookie tient toujours.
  const encoreBloque = await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip, cookie});
  expect(encoreBloque.status()).toBe(404);
  expect(blocagesDe(ip)).toBe(0);
  expect(blocagesDe(visitorId)).toBe(1);

  // La levée de l'autre clé lui rend le site.
  await lever(request, 'visitor', visitorId);
  const rendu = await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip, cookie});
  expect(rendu.status()).toBe(200);

  // Et le registre garde la trace des deux décisions, **rendue** à l'écran :
  // c'est ce qui distingue un blocage levé d'un effacement (AD-7). Sans cette
  // assertion, filtrer la page sur les clés en vigueur ne casserait rien.
  const liste = await request.get('/admin/blocages');
  const html = await liste.text();
  expect(liste.status()).toBe(200);
  for (const cle of [ip, visitorId]) {
    const ligne = html.slice(html.indexOf(cle));
    expect(ligne, cle).toContain('Levé le');
  }
  expect(html).toContain(visitorId);
});

test('la visite dʼun bloqué reste journalisée : son insistance se voit dans lʼadmin', async ({request}, testInfo) => {
  const ip = adresse(testInfo, 150);
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const {visitorId, sessionId} = idsRecus(await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip}));
  expect(sessionsSignees(userAgent)).toBe(1);

  await bloquer(request, sessionId);

  // Il revient, sans ses cookies : une session de plus, bloquée par l'adresse.
  const retour = await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip});
  expect(retour.status()).toBe(404);
  expect(sessionsSignees(userAgent)).toBe(2);

  // La fiche de la session d'origine le dit, et propose de lever.
  const fiche = await request.get(`/admin/sessions/${sessionId}`);
  const corps = await fiche.text();
  expect(fiche.status()).toBe(200);
  expect(corps).toContain('Bloqué');
  expect(corps).toContain('Lever');
  expect(corps).toContain(visitorId);

  // Et la page des blocages porte les deux clés, en vigueur.
  const liste = await request.get('/admin/blocages');
  const html = await liste.text();
  expect(liste.status()).toBe(200);
  expect(html).toContain(visitorId);
  expect(html).toContain('En vigueur');
});

test('le test de fumée nʼest ni journalisé ni bloqué : un déploiement ne se ferme pas tout seul', async ({
  request
}, testInfo) => {
  const ip = adresse(testInfo, 200);
  const fumee = 'cv-site-smoke/0.0.0-test';
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const {sessionId} = idsRecus(await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip}));

  await bloquer(request, sessionId);

  // Même adresse, agent de fumée : `recordVisit` sort avant tout verdict, donc
  // la sonde d'après déploiement passe — et n'écrit rien.
  const sonde = await visiter(request, '/fr', {'user-agent': fumee, 'x-client-ip': ip});
  expect(sonde.status()).toBe(200);
  expect(sessionsSignees(fumee)).toBe(0);
});

test('les deux formulaires de lʼadmin marchent au clic, sans JavaScript', async ({browser, request}, testInfo) => {
  const ip = adresse(testInfo, 250);
  const userAgent = `blocage-spec/${testInfo.testId}`;
  const {visitorId, sessionId} = idsRecus(await visiter(request, '/fr', {'user-agent': userAgent, 'x-client-ip': ip}));

  // Sans JavaScript : ce sont des formulaires HTML vers des routes, et un `303`
  // en retour (AD-10, aucune Server Action). Les deux autres mutations de
  // l'admin sont éprouvées ainsi ; celles-ci doivent l'être aussi.
  const contexte = await browser.newContext({javaScriptEnabled: false, viewport: {width: 1280, height: 900}});
  const page = await contexte.newPage();

  await page.goto(`/admin/sessions/${sessionId}`);
  await expect(page.locator('[data-access]')).toHaveText('Ouvert');
  await page.getByRole('button', {name: 'Bloquer ce visiteur'}).click();

  // Retour sur la fiche, les deux clés fermées, et la levée proposée pour chacune.
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page.locator('[data-access]')).toContainText('Bloqué');
  await expect(page.locator('[data-access]')).toContainText('cookie et adresse');
  expect(blocagesDe(visitorId)).toBe(1);
  expect(blocagesDe(ip)).toBe(1);
  // Les deux clés fermées : plus de formulaire de blocage sur la fiche.
  await expect(page.locator('[data-block-submit]')).toHaveCount(0);

  // La page du registre, et une levée au clic.
  await page.goto('/admin/blocages');
  await expect(page.getByRole('link', {name: 'Blocages'})).toHaveAttribute('aria-current', 'page');
  const ligneAdresse = page.locator(`tr:has([data-block-value]:text-is("${ip}"))`);
  await expect(ligneAdresse.locator('[data-block-kind]')).toHaveText('adresse');
  await expect(ligneAdresse.locator('[data-block-state]')).toContainText('En vigueur');
  await ligneAdresse.locator('[data-lift-submit]').click();

  await expect(page).toHaveURL(/\/admin\/blocages$/);
  expect(blocagesDe(ip)).toBe(0);
  expect(blocagesDe(visitorId)).toBe(1);
  // La ligne reste, datée de sa levée, et son bouton a disparu.
  const apres = page.locator(`tr:has([data-block-value]:text-is("${ip}"))`);
  await expect(apres.locator('[data-block-state]')).toContainText('Levé le');
  await expect(apres.locator('[data-lift-submit]')).toHaveCount(0);

  // Une clé reste fermée : la fiche propose de refermer celle qui est ouverte.
  await page.goto(`/admin/sessions/${sessionId}`);
  await expect(page.locator('[data-access]')).toContainText('cookie');
  await expect(page.getByRole('button', {name: 'Fermer la clé restante'})).toBeVisible();

  await contexte.close();
});
