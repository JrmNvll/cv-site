import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test, type APIRequestContext, type APIResponse, type Locator, type Page} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {formatInteger, formatMicroUsd} from '../../src/app/(admin)/admin/_lib/format';
import {MONTHLY_CAP_MICRO_USD} from '../../src/agent/pricing';
import {MATCH_QUESTION} from '../../src/app/(site)/[locale]/_components/hero-questions';
import {parseQaFile, type QaEntry} from '../../src/content/qa-parser';
import {adressePropre, exchangesOfSession, expectedCost, lire, ouvrirPanneau, poser, scenarios, sessionDuContexte} from './chat-helpers';
import {heroLabel, sentinelle} from './hero-labels';

/**
 * Preuve navigateur de l'espace d'administration (CAP-7, story 8), contre
 * l'**artefact de production** — servi sans `ADMIN_DEV`, comme derrière Caddy.
 *
 * Ce qui est prouvé ici, et nulle part ailleurs : qu'une question posée sur
 * le site se retrouve dans `/admin` avec sa session, son visiteur et son
 * coût ; que la réponse y est rendue et ses sources listées ; que nommer un
 * visiteur et étiqueter une adresse **par un formulaire HTML** se lit ensuite
 * partout, sessions futures comprises, IPv6 comprise ; que les puces cliquées
 * et les questions libres se comptent ; que la liste se pagine ; que visiter
 * l'admin n'écrit rien dans `usage.db` et ne pose aucun cookie ; qu'une
 * origine étrangère est refusée sans écriture ; que tout tient sans
 * JavaScript ; et que le site, lui, n'a pas bougé — ni sa 404, ni ce qui
 * reste hors des deux racines.
 *
 * Les autres fichiers écrivent dans la même base en parallèle : on ne relit
 * que ce qu'on vient d'écrire — jamais un total, jamais un rang.
 */
const FIXTURES = resolve(__dirname, '../fixtures/content');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const VIEWPORT = {width: 1440, height: 900};

const corpusFr: Record<string, QaEntry> = Object.fromEntries(
  parseQaFile(readFileSync(resolve(FIXTURES, 'qa.fr.md'), 'utf8'), 'fr').entries.map((entry) => [entry.id, entry])
);

type VisitorRow = {id: string; name: string | null; note: string | null};
type SessionRow = {id: string; visitor_id: string; ip: string; last_seen_at: string};

const visitor = (id: string) => lire<VisitorRow>('SELECT id, name, note FROM visitor WHERE id = ?', id)[0];
const session = (id: string) => lire<SessionRow>('SELECT id, visitor_id, ip, last_seen_at FROM session WHERE id = ?', id)[0];
const sessionsSignees = (userAgent: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM session WHERE user_agent = ?', userAgent)[0]!.n;
const visiteursSignes = (userAgent: string) =>
  lire<{n: number}>(
    'SELECT count(DISTINCT visitor_id) AS n FROM session WHERE user_agent = ?',
    userAgent
  )[0]!.n;
const ipLabel = (ip: string) => lire<{label: string}>('SELECT label FROM ip_label WHERE ip = ?', ip)[0]?.label;

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

/** Une visite du site par l'API, sans cookie renvoyé : une session neuve à chaque fois. */
async function visiteSansQuestion(
  request: APIRequestContext,
  headers: Record<string, string>
): Promise<{visitorId: string; sessionId: string}> {
  const response = await request.get('/fr', {headers});
  await response.text();
  expect(response.status()).toBe(200);
  return idsRecus(response);
}

/** Une session avec deux échanges — une puce, puis une question au simulateur — depuis le navigateur. */
async function sessionAvecQuestion(page: Page, question: string): Promise<{sessionId: string; visitorId: string; panneau: Locator}> {
  await page.goto('/fr');
  await page.waitForLoadState('networkidle');
  const sessionId = sessionDuContexte(await page.context().cookies());
  const panneau = await ouvrirPanneau(page, 'fr', VIEWPORT.width);
  await panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true}).click();
  await expect(panneau.getByRole('heading', {level: 3})).toBeVisible();
  await panneau.getByRole('button', {name: fr.assistant.back, exact: true}).click();
  const response = await poser(page, panneau, 'fr', question);
  expect(response.status()).toBe(200);
  await expect(panneau.locator('[data-answer="answered"]')).toBeVisible();
  // Les deux échanges sont commis avant qu'on lise l'admin.
  await expect.poll(() => exchangesOfSession(sessionId).length).toBe(2);
  return {sessionId, visitorId: session(sessionId)!.visitor_id, panneau};
}

/** Colle une annonce par la sixième puce et l'envoie ; attend la fin du flux. */
async function collerAnnonce(page: Page, panneau: Locator, annonce: string): Promise<void> {
  await panneau.getByRole('button', {name: fr.assistant.back, exact: true}).click();
  await panneau.getByRole('button', {name: heroLabel('fr', MATCH_QUESTION), exact: true}).click();
  const zone = panneau.getByRole('textbox', {name: fr.assistant.matchLabel, exact: true});
  await zone.fill(annonce);
  const appel = page.waitForResponse((response) => response.url().endsWith('/api/match'));
  await panneau.getByRole('button', {name: fr.assistant.matchSend, exact: true}).click();
  expect((await appel).status()).toBe(200);
  await expect(panneau.locator('[data-answer="answered"][data-kind="match"]')).toBeVisible();
}

/**
 * La ligne d'une session dans la liste — sur la page courante, puis les
 * suivantes : d'autres tests écrivent en parallèle, le rang n'est pas connu.
 */
async function ligneDeSession(page: Page, sessionId: string, tout: boolean) {
  for (let numero = 1; numero <= 10; numero++) {
    await page.goto(`/admin?${tout ? 'tout=1&' : ''}page=${numero}`);
    const ligne = page.locator(`tr[data-session="${sessionId}"]`);
    if ((await ligne.count()) === 1) return ligne;
    if ((await page.getByRole('link', {name: 'Page suivante →'}).count()) === 0) return null;
  }
  return null;
}

/** Les micro-USD d'un montant affiché « 0,128 USD » — pour comparer un compteur à un seuil. */
function microUsdAffiches(texte: string): number {
  const [montant] = texte.trim().split(' ');
  return Math.round(Number(montant!.replace(/[’']/g, '').replace(',', '.')) * 1_000_000);
}

test.use({viewport: VIEWPORT});

test('une question posée sur le site se lit dans /admin : compteurs, session, visiteur, coût — puis le détail, réponse rendue et sources', async ({
  page,
  context
}, testInfo) => {
  const ip = await adressePropre(context, testInfo);
  const question = `Question admin ${testInfo.testId.slice(-8)}`;
  const {sessionId, visitorId} = await sessionAvecQuestion(page, question);
  const cout = expectedCost(scenarios.ordinary.usage);

  // Le tableau de bord : les compteurs — d'autres tests écrivent, donc des
  // planchers —, le plafond, et la ligne de la session.
  const ligne = await ligneDeSession(page, sessionId, false);
  expect(ligne, 'la session doit être dans la liste par défaut').not.toBeNull();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page).toHaveTitle('Tableau de bord — Administration');
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Tableau de bord');
  const depense = await page.locator('[data-stat="spend"]').innerText();
  expect(depense.endsWith(`/ ${formatMicroUsd(MONTHLY_CAP_MICRO_USD)}`), depense).toBe(true);
  // Affiché à trois décimales, arrondi : un demi-millième de marge.
  expect(microUsdAffiches(depense)).toBeGreaterThanOrEqual(cout - 500);
  expect(Number((await page.locator('[data-stat="exchanges"]').innerText()).replace(/\D/g, ''))).toBeGreaterThanOrEqual(2);
  expect(Number((await page.locator('[data-stat="sessions"]').innerText()).replace(/\D/g, ''))).toBeGreaterThanOrEqual(1);
  // La section courante est marquée.
  await expect(page.getByRole('navigation', {name: 'Administration'}).getByRole('link', {name: 'Tableau de bord'})).toHaveAttribute(
    'aria-current',
    'page'
  );
  const cellules = ligne!.locator('td');
  // Visiteur : l'identifiant abrégé, faute de nom ; adresse : celle de X-Client-IP ; deux échanges ; le coût du simulateur.
  await expect(cellules.nth(1)).toHaveText(`${visitorId.slice(0, 4)}…${visitorId.slice(-4)}`);
  await expect(cellules.nth(2)).toHaveText(ip);
  await expect(cellules.nth(3)).toHaveText('français');
  await expect(cellules.nth(5)).toHaveText('2');
  await expect(cellules.nth(6)).toHaveText(formatMicroUsd(cout));

  // Le détail, par le lien de la ligne.
  await cellules.nth(0).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page).toHaveTitle(/^Session du .* — Administration$/);
  await expect(page.getByRole('navigation', {name: 'Fil d’Ariane'})).toContainText('Session');
  await expect(page.locator('[data-address]')).toContainText(ip);
  const echanges = page.locator('[data-exchange]');
  await expect(echanges).toHaveCount(2);
  // La puce : sa question du corpus en texte, son corps rendu (le Markdown devient des éléments), sa source.
  const puce = echanges.nth(0);
  await expect(puce).toHaveAttribute('data-kind', 'hero');
  await expect(puce).toHaveAttribute('data-status', 'done');
  await expect(puce.locator('[data-question]')).toHaveText(corpusFr['lic-01']!.question);
  await expect(puce.locator('[data-answer]')).toContainText(sentinelle('fr', 'lic-01'));
  await expect(puce.locator('[data-answer] strong')).toHaveText('dès maintenant');
  await expect(puce.locator('[data-sources]')).toHaveText('qa:lic-01');
  // La question libre : le texte tapé, la réponse simulée rendue — gras et liste, aucun marqueur brut —, ses sources.
  const libre = echanges.nth(1);
  await expect(libre).toHaveAttribute('data-kind', 'chat');
  await expect(libre.locator('[data-question]')).toHaveText(question);
  await expect(libre.locator('[data-answer] strong')).toHaveText('simulée');
  await expect(libre.locator('[data-answer] ul li')).toHaveCount(2);
  await expect(libre.locator('[data-answer]')).toContainText('Reponse-simulee');
  expect(await libre.locator('[data-answer]').innerText()).not.toMatch(/\*\*|\n- |<sour/);
  await expect(libre.locator('[data-sources]')).toHaveText(scenarios.ordinary.sources.join(', '));
  await expect(libre).toContainText(formatMicroUsd(cout));
  await expect(libre).toContainText(formatInteger(scenarios.ordinary.usage.input_tokens));
});

test('?tout=1 montre aussi une session sans échange, que la liste par défaut écarte', async ({page, request}, testInfo) => {
  const {sessionId} = await visiteSansQuestion(request, {'user-agent': `admin-spec/${testInfo.testId}`});

  expect(await ligneDeSession(page, sessionId, true), 'visible avec ?tout=1').not.toBeNull();
  expect(await ligneDeSession(page, sessionId, false), 'absente de la liste par défaut').toBeNull();
  // Le détail dit l'absence d'échange.
  await page.goto(`/admin/sessions/${sessionId}`);
  await expect(page.getByText('Aucun échange')).toBeVisible();
});

test('la liste se pagine : 51 sessions signées, « Page suivante → » mène à ?tout=1&page=2 avec lʼune dʼelles', async ({
  page,
  request
}, testInfo) => {
  const userAgent = `admin-spec/${testInfo.testId}`;
  const ids = new Set<string>();
  for (let i = 0; i < 51; i++) ids.add((await visiteSansQuestion(request, {'user-agent': userAgent})).sessionId);
  expect(ids.size).toBe(51);

  await page.goto('/admin?tout=1');
  await expect(page.locator('tr[data-session]')).toHaveCount(50);
  await expect(page.getByRole('navigation', {name: 'Pages'})).toContainText('Page 1 sur');
  await page.getByRole('link', {name: 'Page suivante →'}).click();

  await expect(page).toHaveURL(/\/admin\?tout=1&page=2$/);
  await expect(page.getByRole('navigation', {name: 'Pages'})).toContainText('Page 2 sur');
  await expect(page.getByRole('link', {name: '← Page précédente'})).toHaveAttribute('href', '/admin?tout=1');
  const surLaPage = await page.locator('tr[data-session]').evaluateAll((lignes) => lignes.map((ligne) => ligne.getAttribute('data-session')));
  expect(surLaPage.length).toBeGreaterThan(0);
  expect(surLaPage.some((id) => ids.has(id!)), 'au moins une session signée sur la page 2').toBe(true);
});

test('nommer le visiteur par le formulaire : le nom apparaît dans le détail, la fiche et la liste', async ({
  page,
  context
}, testInfo) => {
  await adressePropre(context, testInfo);
  const {sessionId, visitorId} = await sessionAvecQuestion(page, `Question nom ${testInfo.testId.slice(-8)}`);
  const nom = `Recruteuse fictive ${testInfo.testId.slice(-6)}`;

  await page.goto(`/admin/sessions/${sessionId}`);
  const formulaire = page.getByRole('form', {name: 'Nommer le visiteur'});
  await formulaire.getByLabel('Nom', {exact: true}).fill(nom);
  await formulaire.getByLabel('Note', {exact: true}).fill('Vue en entretien fictif.');
  await formulaire.getByRole('button', {name: 'Enregistrer le visiteur'}).click();

  // 303 vers la page d'origine, qui relit la base.
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page.locator('[data-visitor]')).toHaveText(nom);
  expect(visitor(visitorId)).toEqual({id: visitorId, name: nom, note: 'Vue en entretien fictif.'});

  // La fiche, et la liste.
  await page.locator('[data-visitor]').click();
  await expect(page).toHaveURL(new RegExp(`/admin/visiteurs/${visitorId}$`));
  await expect(page).toHaveTitle(`Visiteur ${nom} — Administration`);
  await expect(page.locator('[data-visitor-name]')).toHaveText(nom);
  await expect(page.locator('[data-visitor-note]')).toHaveText('Vue en entretien fictif.');
  await expect(page.locator(`tr[data-session="${sessionId}"]`)).toHaveCount(1);
  const ligne = await ligneDeSession(page, sessionId, false);
  await expect(ligne!.locator('td').nth(1)).toHaveText(nom);

  // Retirer : un nom vide, l'identifiant abrégé reprend sa place — rien n'est supprimé.
  await page.goto(`/admin/visiteurs/${visitorId}`);
  await page.getByLabel('Nom', {exact: true}).fill('');
  await page.getByRole('button', {name: 'Enregistrer le visiteur'}).click();
  await expect(page).toHaveURL(new RegExp(`/admin/visiteurs/${visitorId}$`));
  await expect(page.locator('[data-visitor-name]')).toHaveText(`${visitorId.slice(0, 4)}…${visitorId.slice(-4)}`);
  expect(visitor(visitorId)).toEqual({id: visitorId, name: '', note: 'Vue en entretien fictif.'});
});

test('étiqueter lʼadresse : lʼétiquette suit lʼadresse sur une autre session passée, et sur une session future', async ({
  page,
  request
}, testInfo) => {
  // Deux sessions de la même adresse, avant l'étiquette ; une troisième après.
  const ip = `203.0.${(testInfo.parallelIndex + 100) % 250}.${(testInfo.workerIndex % 200) + 1}`;
  const entetes = {'user-agent': `admin-spec/${testInfo.testId}`, 'x-client-ip': ip};
  const premiere = await visiteSansQuestion(request, entetes);
  const seconde = await visiteSansQuestion(request, entetes);
  const etiquette = `Bureau fictif ${testInfo.testId.slice(-6)}`;

  await page.goto(`/admin/sessions/${premiere.sessionId}`);
  await expect(page.locator('[data-address]')).toHaveText(ip);
  const formulaire = page.getByRole('form', {name: 'Étiqueter l’adresse'});
  await formulaire.getByLabel(`Étiquette de l’adresse ${ip}`).fill(etiquette);
  await formulaire.getByRole('button', {name: 'Enregistrer l’étiquette'}).click();

  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${premiere.sessionId}$`));
  await expect(page.locator('[data-address]')).toContainText(etiquette);
  expect(ipLabel(ip)).toBe(etiquette);

  // L'autre session passée de la même adresse, et une session future.
  await page.goto(`/admin/sessions/${seconde.sessionId}`);
  await expect(page.locator('[data-address]')).toContainText(etiquette);
  const future = await visiteSansQuestion(request, entetes);
  await page.goto(`/admin/sessions/${future.sessionId}`);
  await expect(page.locator('[data-address]')).toContainText(etiquette);
  const ligne = await ligneDeSession(page, future.sessionId, true);
  await expect(ligne!.locator('td').nth(2)).toHaveText(etiquette);
});

test('étiqueter une adresse IPv6 : le segment de la route porte les deux-points, lʼétiquette se relit', async ({
  page,
  request
}, testInfo) => {
  const ip = '2001:db8::1';
  const {sessionId} = await visiteSansQuestion(request, {'user-agent': `admin-spec/${testInfo.testId}`, 'x-client-ip': ip});
  expect(session(sessionId)!.ip).toBe(ip);
  const etiquette = `IPv6 fictive ${testInfo.testId.slice(-6)}`;

  await page.goto(`/admin/sessions/${sessionId}`);
  const formulaire = page.getByRole('form', {name: 'Étiqueter l’adresse'});
  await expect(formulaire).toHaveAttribute('action', `/admin/api/adresses/${encodeURIComponent(ip)}`);
  await formulaire.getByLabel(`Étiquette de l’adresse ${ip}`).fill(etiquette);
  await formulaire.getByRole('button', {name: 'Enregistrer l’étiquette'}).click();

  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page.locator('[data-address]')).toContainText(etiquette);
  await expect(page.locator('[data-address]')).toContainText(ip);
  expect(ipLabel(ip)).toBe(etiquette);
});

test('/admin/questions compte les puces cliquées, et classe la question libre et lʼannonce par texte normalisé', async ({
  page,
  context
}, testInfo) => {
  await adressePropre(context, testInfo);
  const compte = async () => {
    await page.goto('/admin/questions');
    const cellule = page.locator('tr[data-question-id="sit-02"] [data-count]');
    return (await cellule.count()) === 0 ? 0 : Number((await cellule.innerText()).replace(/\D/g, ''));
  };
  const avant = await compte();

  // Deux clics sur une puce, une question libre en majuscules et blancs
  // redoublés, une annonce collée.
  const marque = testInfo.testId.slice(-8);
  const question = `QUESTION  Libre ${marque}`;
  const {panneau} = await sessionAvecQuestion(page, question);
  for (let fois = 0; fois < 2; fois++) {
    await panneau.getByRole('button', {name: fr.assistant.back, exact: true}).click();
    await panneau.getByRole('button', {name: heroLabel('fr', 'sit-02'), exact: true}).click();
    await expect(panneau.getByRole('heading', {level: 3})).toBeVisible();
  }
  const annonce = `Annonce Fictive ${marque}\n\nPoste imaginaire, entreprise inventée.`;
  await collerAnnonce(page, panneau, annonce);

  // D'autres tests cliquent en parallèle : au moins deux de plus, jamais moins.
  await expect.poll(compte).toBeGreaterThanOrEqual(avant + 2);
  await expect(page).toHaveTitle('Questions — Administration');
  await expect(page.getByRole('navigation', {name: 'Administration'}).getByRole('link', {name: 'Questions'})).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('tr[data-question-id="sit-02"] td').first()).toHaveText(corpusFr['sit-02']!.question);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  // Le second classement : minuscules, blancs réduits, la sorte en français.
  const libres = page.locator('[data-ranking="free"] tbody tr');
  const ligneQuestion = libres.filter({hasText: `question libre ${marque.toLowerCase()}`});
  await expect(ligneQuestion).toHaveCount(1);
  await expect(ligneQuestion.locator('td').nth(0)).toHaveText(`question libre ${marque.toLowerCase()}`);
  await expect(ligneQuestion.locator('td').nth(1)).toHaveText('question');
  await expect(ligneQuestion.locator('td').nth(2)).toHaveText('1');
  const ligneAnnonce = libres.filter({hasText: `annonce fictive ${marque.toLowerCase()}`});
  await expect(ligneAnnonce).toHaveCount(1);
  await expect(ligneAnnonce.locator('td').nth(0)).toHaveText(
    `annonce fictive ${marque.toLowerCase()} poste imaginaire, entreprise inventée.`
  );
  await expect(ligneAnnonce.locator('td').nth(1)).toHaveText('annonce');
});

test('visiter lʼadmin nʼécrit rien : aucune session, last_seen_at inchangé, aucun Set-Cookie', async ({
  browser,
  request
}, testInfo) => {
  // Le `User-Agent` est la signature du test dans la base : un contexte à lui,
  // Chromium ne le laisse pas réécrire par un en-tête supplémentaire.
  const userAgent = `admin-spec/${testInfo.testId}`;
  const context = await browser.newContext({userAgent, viewport: VIEWPORT});
  const page = await context.newPage();
  // Une visite du site d'abord : le navigateur porte alors des cookies de visite.
  await page.goto('/fr');
  await page.waitForLoadState('networkidle');
  const sessionId = sessionDuContexte(await context.cookies());
  const avant = session(sessionId)!;
  expect(sessionsSignees(userAgent)).toBe(1);
  expect(visiteursSignes(userAgent)).toBe(1);

  // Puis l'admin, avec ces cookies : pages, détail, 404, formulaire.
  const reponses = [];
  for (const chemin of ['/admin', '/admin?tout=1', `/admin/sessions/${sessionId}`, '/admin/questions', '/admin/inconnu']) {
    const response = await page.goto(chemin);
    reponses.push(response!);
    expect(response!.headers()['set-cookie'], chemin).toBeUndefined();
  }
  expect(reponses.map((response) => response.status())).toEqual([200, 200, 200, 200, 404]);
  await page.goto(`/admin/visiteurs/${avant.visitor_id}`);
  await page.getByLabel('Nom', {exact: true}).fill('Nom posé depuis lʼadmin');
  await page.getByRole('button', {name: 'Enregistrer le visiteur'}).click();
  await expect(page.locator('[data-visitor-name]')).toHaveText('Nom posé depuis lʼadmin');
  // Et par l'API, sans cookie du tout.
  const brut = await request.get('/admin', {headers: {'user-agent': userAgent}});
  await brut.text();
  expect(brut.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie')).toBe(false);
  expect(brut.headers()['cache-control']).toContain('no-store');

  // Rien n'a bougé dans le journal des visites : ni session, ni visiteur, ni activité.
  expect(sessionsSignees(userAgent)).toBe(1);
  expect(visiteursSignes(userAgent)).toBe(1);
  expect(session(sessionId)).toEqual(avant);
  await context.close();
});

test('un POST dʼorigine étrangère est refusé (403) sans rien écrire ; une autre méthode ou un autre corps, 405 et 415', async ({
  request
}, testInfo) => {
  const {visitorId} = await visiteSansQuestion(request, {'user-agent': `admin-spec/${testInfo.testId}`});
  const avant = visitor(visitorId);

  const etranger = await request.post(`/admin/api/visiteurs/${visitorId}`, {
    headers: {'sec-fetch-site': 'cross-site'},
    form: {name: 'Intrus', note: '', from: '/admin'}
  });
  expect(etranger.status()).toBe(403);
  expect(visitor(visitorId)).toEqual(avant);

  // Sans Sec-Fetch-Site ni Origin — `curl` — non plus.
  const anonyme = await request.post(`/admin/api/visiteurs/${visitorId}`, {form: {name: 'Intrus', from: '/admin'}});
  expect(anonyme.status()).toBe(403);
  expect(visitor(visitorId)).toEqual(avant);

  // Une autre méthode, un autre corps : dits pour ce qu'ils sont. La route
  // n'exporte que `POST` : c'est Next qui répond `405` à `PUT`, avant elle —
  // sans en-tête `Allow`, que seul son propre `405` porte (prouvé en unitaire).
  const put = await request.put(`/admin/api/visiteurs/${visitorId}`, {headers: {'sec-fetch-site': 'same-origin'}, form: {name: 'x'}});
  expect(put.status()).toBe(405);
  const json = await request.post(`/admin/api/visiteurs/${visitorId}`, {
    headers: {'sec-fetch-site': 'same-origin'},
    data: {name: 'Intrus', from: '/admin'}
  });
  expect(json.status()).toBe(415);
  expect(visitor(visitorId)).toEqual(avant);

  // La même requête, même origine : écrite, 303.
  const legitime = await request.post(`/admin/api/visiteurs/${visitorId}`, {
    headers: {'sec-fetch-site': 'same-origin'},
    form: {name: 'Nom légitime', note: '', from: '/admin?tout=1&page=2'},
    maxRedirects: 0
  });
  expect(legitime.status()).toBe(303);
  expect(legitime.headers().location).toBe('/admin?tout=1&page=2');
  expect(visitor(visitorId)!.name).toBe('Nom légitime');
});

test('lʼadmin est en français, noindex, et sa 404 aussi — session inconnue, visiteur mal formé, chemin inconnu', async ({page}) => {
  const response = await page.goto('/admin');
  expect(response!.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page).toHaveTitle('Tableau de bord — Administration');
  await expect(page.getByRole('navigation', {name: 'Administration'}).getByRole('link', {name: 'Questions'})).toBeVisible();

  for (const chemin of ['/admin/sessions/01K4EXAMPSESS0000000000000', '/admin/visiteurs/pas-un-ulid', '/admin/inconnu']) {
    const inconnu = await page.goto(chemin);
    expect(inconnu!.status(), chemin).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    // Next ajoute sa propre balise `noindex` à toute 404 : la nôtre est là aussi.
    await expect(page.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1);
    await expect(page).toHaveTitle('Introuvable — Administration');
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Introuvable');
    await expect(page.getByRole('link', {name: 'Retour au tableau de bord'})).toHaveAttribute('href', '/admin');
  }
});

test('sans JavaScript : liste, bascule tout / avec échanges, détail, les deux formulaires', async ({browser, request}, testInfo) => {
  const ip = `203.0.${(testInfo.parallelIndex + 150) % 250}.${(testInfo.workerIndex % 200) + 1}`;
  const {sessionId, visitorId} = await visiteSansQuestion(request, {'user-agent': `admin-spec/${testInfo.testId}`, 'x-client-ip': ip});
  const contexte = await browser.newContext({javaScriptEnabled: false, viewport: VIEWPORT});
  const page = await contexte.newPage();
  const nom = `Sans script ${testInfo.testId.slice(-6)}`;
  const etiquette = `Étiquette sans script ${testInfo.testId.slice(-6)}`;

  // La liste, et sa bascule par de simples liens.
  await page.goto('/admin');
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Tableau de bord');
  await page.getByRole('link', {name: 'Montrer toutes les sessions, sondes comprises'}).click();
  await expect(page).toHaveURL(/\/admin\?tout=1$/);
  await expect(page.getByRole('heading', {level: 2, name: /Toutes les sessions/})).toBeVisible();
  await page.getByRole('link', {name: 'Ne montrer que les sessions avec échange'}).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', {level: 2, name: /Sessions avec au moins un échange/})).toBeVisible();

  // Le détail, et les deux formulaires.
  await page.goto(`/admin/sessions/${sessionId}`);
  await expect(page.getByRole('heading', {level: 1})).toContainText('Session du');
  const visiteur = page.getByRole('form', {name: 'Nommer le visiteur'});
  await visiteur.getByLabel('Nom', {exact: true}).fill(nom);
  await visiteur.getByRole('button', {name: 'Enregistrer le visiteur'}).click();
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page.locator('[data-visitor]')).toHaveText(nom);
  expect(visitor(visitorId)!.name).toBe(nom);

  const adresse = page.getByRole('form', {name: 'Étiqueter l’adresse'});
  await adresse.getByLabel(`Étiquette de l’adresse ${ip}`).fill(etiquette);
  await adresse.getByRole('button', {name: 'Enregistrer l’étiquette'}).click();
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${sessionId}$`));
  await expect(page.locator('[data-address]')).toContainText(etiquette);
  expect(ipLabel(ip)).toBe(etiquette);
  await contexte.close();
});

test('le site nʼa pas bougé : /foo reste la 404 du site, journalisée, dans sa langue', async ({browser}, testInfo) => {
  const userAgent = `admin-spec/${testInfo.testId}`;
  const context = await browser.newContext({userAgent, viewport: VIEWPORT});
  const page = await context.newPage();

  const response = await page.goto('/foo');

  // Redirigé vers /fr/foo par le proxy, puis la 404 du site, dans son document.
  await expect(page).toHaveURL(/\/fr\/foo$/);
  expect(response!.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1);
  await expect(page.getByRole('heading', {level: 1})).toHaveText(fr.notFound.heading);
  // Et journalisée comme toute visite du site.
  expect(sessionsSignees(userAgent)).toBe(1);
  await context.close();
});

test('une sonde à extension, que le proxy ne voit pas : 404 noindex, sans cookie, sans ligne en base', async ({request}, testInfo) => {
  const userAgent = `admin-spec/${testInfo.testId}`;
  const sonde = async (chemin: string) => {
    const response = await request.get(chemin, {headers: {'user-agent': userAgent}, maxRedirects: 0});
    const corps = await response.text();
    expect(response.status(), chemin).toBe(404);
    // Pas de proxy : ni redirection de langue, ni cookie de visite.
    expect(response.headers().location, chemin).toBeUndefined();
    expect(response.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie'), chemin).toBe(false);
    expect(corps, chemin).toContain('name="robots" content="noindex, nofollow"');
    expect(corps, chemin).not.toContain('Introuvable');
    return corps;
  };

  // À plusieurs segments : aucune route, la 404 globale — le document du
  // site, rendu **côté serveur**, le `<h1>` dans le HTML.
  const globale = await sonde('/api/inconnu');
  expect(globale).toContain('<html lang="fr"');
  expect(globale).toMatch(new RegExp(`<h1[^>]*>${fr.notFound.heading}</h1>`));
  expect(globale).not.toContain('__next_error__');
  // À un segment : `[locale]` l'attrape, son layout lève `notFound()`, et Next
  // ne sert qu'une coquille que le navigateur remplit — comme avant la story.
  for (const chemin of ['/wp-login.php', '/.env']) {
    const coquille = await sonde(chemin);
    expect(coquille, chemin).toContain('__next_error__');
    expect(coquille, chemin).toContain(fr.notFound.heading);
  }
  // Sans cookie de visite, rien n'est écrit : une sonde n'est pas une visite.
  expect(sessionsSignees(userAgent)).toBe(0);
});

test('la 404 du site est un document complet, lisible sans JavaScript, et journalisée', async ({browser, request}, testInfo) => {
  const userAgent = `admin-spec/${testInfo.testId}`;
  // Par l'API d'abord : le HTML brut porte le titre, et la visite est en base.
  const brut = await request.get('/fr/chemin-inexistant', {headers: {'user-agent': userAgent}});
  const corps = await brut.text();
  expect(brut.status()).toBe(404);
  expect(corps).toMatch(new RegExp(`<h1[^>]*>${fr.notFound.heading}</h1>`));
  expect(corps).not.toContain('__next_error__');
  expect(sessionsSignees(userAgent)).toBe(1);
  // Puis sans JavaScript, en anglais.
  const contexte = await browser.newContext({javaScriptEnabled: false, userAgent, viewport: VIEWPORT});
  const page = await contexte.newPage();
  const response = await page.goto('/en/chemin-inexistant');
  expect(response!.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', {level: 1})).toHaveText(en.notFound.heading);
  expect(sessionsSignees(userAgent)).toBe(2);
  await contexte.close();
});
