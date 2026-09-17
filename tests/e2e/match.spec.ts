import {expect, test, type Locator, type Page} from '@playwright/test';
import {MESSAGE_LABELS, MATCH_PARTS, MATCH_TITLES} from '../../src/agent/prompts';
import {AD_MAX_CHARS, createSseDecoder, type ChatEvent} from '../../src/app/_lib/chat-contract';
import {MATCH_QUESTION} from '../../src/app/(site)/[locale]/_components/hero-questions';
import {
  adressePropre,
  capturerLeFlux,
  champLibre,
  exchange,
  exchangesOfSession,
  expectedCost,
  fluxCaptures,
  ligneDesSources,
  messages,
  observerLeFlux,
  ouvrirPanneau,
  poser,
  requetesDuSimulateur,
  scenarios,
  sessionDuContexte
} from './chat-helpers';
import {LANGS, type Lang} from './fixture-cv';
import {heroLabel} from './hero-labels';

/**
 * Preuve navigateur de l'évaluation d'adéquation (CAP-4, AD-17, story 7),
 * contre l'**artefact de production** et le **simulateur** : la sixième puce
 * ouvre une zone, l'annonce collée part vers `/api/match`, les quatre parties
 * arrivent au fil de l'eau sous leur titre, **aucune marque ni identifiant**
 * n'atteint le navigateur — ni le flux, ni l'écran —, la ligne des sources
 * compte l'union des marques et du bloc, et `usage.db` porte un `exchange` de
 * sorte `match` dont `question` est l'annonce entière. Le bloc système d'une
 * annonce est, au sha près, celui d'une question libre : un seul préfixe de
 * cache ; et l'annonce n'est pas rejouée dans l'historique, son repère si.
 *
 * Chaque test a son propre visiteur et sa propre adresse pour rester sous le
 * limiteur — une annonce y compte comme une question.
 */
const VIEWPORTS = [
  {name: 'dans le tiroir (390 px)', viewport: {width: 390, height: 844}},
  {name: 'dans le premier écran (1440 px)', viewport: {width: 1440, height: 900}}
] as const;

/** Les événements SSE d'une réponse, décodés par le même décodeur que le navigateur. */
function decoder(body: string): ChatEvent[] {
  const sse = createSseDecoder();
  return [...sse.push(body), ...sse.end()];
}

/** Une annonce fictive, unique par test — jamais un texte réel. */
function annonceFictive(locale: Lang, marque: string, extra = ''): string {
  return [
    `Annonce fictive ${locale} ${marque}${extra}`,
    'Poste : personne pour un atelier imaginaire.',
    'Demandé : dix ans de parcours, disponibilité immédiate, une certification.'
  ].join('\n');
}

/** La zone de l'annonce, par son nom court — l'invite, elle, la décrit. */
function zoneDe(panneau: Locator, locale: Lang): Locator {
  return panneau.getByRole('textbox', {name: messages[locale].assistant.matchLabel, exact: true});
}

/** Le compte affiché sous la zone : lu sur son attribut, plus stable qu'une chaîne ICU formatée. */
function compte(panneau: Locator): Locator {
  return panneau.locator('[data-ad-count]');
}

/** Clique la sixième puce ; rend la zone, visible, active, focalisée et décrite par l'invite. */
async function ouvrirZone(panneau: Locator, locale: Lang): Promise<Locator> {
  await panneau.getByRole('button', {name: heroLabel(locale, MATCH_QUESTION), exact: true}).click();
  const zone = zoneDe(panneau, locale);
  await expect(zone).toBeVisible();
  await expect(zone).toBeEnabled();
  await expect(zone).toBeFocused();
  await expect(zone).toHaveAccessibleDescription(messages[locale].assistant.matchIntro);
  return zone;
}

/** Colle une annonce et l'envoie ; rend la réponse HTTP de `/api/match`. */
async function coller(page: Page, panneau: Locator, locale: Lang, ad: string) {
  const zone = await ouvrirZone(panneau, locale);
  await zone.fill(ad);
  const appel = page.waitForResponse((response) => response.url().endsWith('/api/match'));
  await panneau.getByRole('button', {name: messages[locale].assistant.matchSend, exact: true}).click();
  return appel;
}

/**
 * Ce qui ne doit jamais atteindre le navigateur dans le flux : une marque,
 * entière ou fragmentée, ou le bloc. L'événement `done`, lui, porte les clés
 * des sources valides — c'est le contrat d'AD-16, le même que `/api/chat`.
 */
function sansMarqueNiBloc(texte: string): void {
  expect(texte).not.toMatch(/\[(qa|cv):/i);
  expect(texte).not.toContain('sources>');
  expect(texte).not.toContain('<sour');
}

/**
 * Ce qui ne doit jamais atteindre la zone de réponse ni le texte des deltas :
 * aucune marque, aucun des identifiants exacts que le simulateur déclare.
 * Pas un motif plus large — un libellé qui contiendrait « profil » ferait
 * échouer le test pour une mauvaise raison.
 */
const IDENTIFIANTS = ['qa:lic-01', 'qa:sit-02', 'cv:profil', 'qa:inexistante'] as const;
function sansIdentifiant(texte: string): void {
  sansMarqueNiBloc(texte);
  for (const id of IDENTIFIANTS) expect(texte).not.toContain(id);
}

for (const {name, viewport} of VIEWPORTS) {
  test.describe(name, () => {
    test.use({viewport});

    for (const locale of LANGS) {
      test(`/${locale} : sixième puce → zone → envoi → quatre parties au fil de lʼeau, sans identifiant, et lʼéchange match en base`, async ({
        page,
        context
      }, testInfo) => {
        await adressePropre(context, testInfo);
        await capturerLeFlux(page);
        await page.goto(`/${locale}`);
        await page.waitForLoadState('networkidle');
        const sessionId = sessionDuContexte(await context.cookies());
        const panneau = await ouvrirPanneau(page, locale, viewport.width);
        const attendu = scenarios.match[locale];

        // La zone : vide, comptée, avec ses deux boutons.
        const zone = await ouvrirZone(panneau, locale);
        await expect(zone).toHaveValue('');
        await expect(compte(panneau)).toHaveAttribute('data-ad-count', '0');
        await expect(compte(panneau)).toContainText(String(AD_MAX_CHARS));
        await expect(panneau.getByRole('button', {name: messages[locale].assistant.matchSend, exact: true})).toBeDisabled();
        const ad = annonceFictive(locale, `${viewport.width} ${testInfo.testId.slice(-8)}`);
        await zone.fill(ad);
        await expect(compte(panneau)).toHaveAttribute('data-ad-count', String(ad.length));
        await expect(compte(panneau)).toContainText(String(ad.length));

        const appel = page.waitForResponse((response) => response.url().endsWith('/api/match'));
        await panneau.getByRole('button', {name: messages[locale].assistant.matchSend, exact: true}).click();
        const etats = await observerLeFlux(page, panneau);
        const response = await appel;

        // Le flux : 200, event-stream, delta… puis done avec l'union des sources valides.
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('text/event-stream');
        expect(response.headers()['cache-control']).toContain('no-store');
        const [flux] = await fluxCaptures(page);
        sansMarqueNiBloc(flux!);
        const events = decoder(flux!);
        const done = events.at(-1);
        expect(done).toMatchObject({type: 'done', sources: attendu.sources});
        const exchangeId = (done as {exchangeId: string}).exchangeId;
        expect(exchangeId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        const deltas = events.filter((event): event is Extract<ChatEvent, {type: 'delta'}> => event.type === 'delta');
        expect(deltas.length).toBeGreaterThanOrEqual(3);
        const recu = deltas.map((event) => event.text).join('');
        sansIdentifiant(recu);
        // Les marques retirées laissent un blanc en fin de ligne ; le texte, lui, est celui du scénario.
        expect(recu.replace(/[ \t]+$/gm, '').trimEnd()).toBe(attendu.text);

        // Au fil de l'eau : le texte grandit, et à aucun moment un identifiant n'a été visible.
        const intermediaires = etats.filter((etat) => etat.state === 'streaming' && etat.text !== '');
        expect(intermediaires.length, 'au moins deux états intermédiaires observés').toBeGreaterThanOrEqual(2);
        expect(intermediaires[0]!.text.length).toBeLessThan(intermediaires.at(-1)!.text.length);
        for (const etat of etats) {
          sansIdentifiant(etat.text);
          sansMarqueNiBloc(etat.panneau);
        }
        expect(etats.at(-1)!.state).toBe('answered');

        // Le rendu final : le titre de l'évaluation — jamais l'annonce —, les
        // quatre parties en gras dans l'ordre, le « [voir CV] » qui n'était pas
        // une marque, la ligne des sources.
        await expect(panneau.getByRole('heading', {level: 3})).toHaveText(messages[locale].assistant.matchTitle);
        const reponse = panneau.locator('[data-answer="answered"]');
        await expect(reponse).toHaveAttribute('data-kind', 'match');
        await expect(reponse.locator('strong')).toHaveText(MATCH_PARTS.map((part) => MATCH_TITLES[locale][part]));
        await expect(reponse.locator('ul')).toHaveCount(3);
        await expect(reponse).toContainText('Reponse-adequation');
        await expect(reponse).toContainText(locale === 'fr' ? '[voir CV]' : '[see CV]');
        const texte = await reponse.innerText();
        sansIdentifiant(texte);
        expect(texte).not.toContain('Annonce fictive');
        expect(texte).not.toMatch(/\*\*|\n- /);
        await expect(panneau.getByText(ligneDesSources(locale, attendu.sources.length), {exact: true})).toBeVisible();

        // Journalisé : `match`, `done`, l'annonce entière en question, la
        // réponse sans marques ni bloc, l'union des sources, `citation_ok = 1`.
        const ligne = exchange(exchangeId);
        expect(ligne, 'lʼéchange doit être en base').toBeDefined();
        expect(ligne).toMatchObject({
          session_id: sessionId,
          kind: 'match',
          status: 'done',
          question: ad,
          answer: attendu.text,
          citation_ok: 1,
          input_tokens: attendu.usage.input_tokens,
          output_tokens: attendu.usage.output_tokens,
          cache_read_tokens: attendu.usage.cache_read_input_tokens,
          cache_creation_tokens: attendu.usage.cache_creation_input_tokens,
          cost_micro_usd: expectedCost(attendu.usage)
        });
        expect(JSON.parse(ligne!.sources!)).toEqual(attendu.sources);

        // Ce que le simulateur a reçu : l'annonce dans `<annonce>`, dans la langue de la page.
        const [requete] = (await requetesDuSimulateur()).filter((candidate) => candidate.ad === ad);
        expect(requete).toMatchObject({scenario: 'match', lang: locale, model: 'claude-opus-5', cacheControl: {type: 'ephemeral'}, messages: 1});
        expect(requete!.question).toBeNull();

        // Retour aux questions : les puces reviennent, le focus sur la sixième ;
        // rouverte, la zone est vide et le compte à zéro — l'annonce évaluée ne
        // reste pas dans la zone.
        await panneau.getByRole('button', {name: messages[locale].assistant.back, exact: true}).click();
        const sixieme = panneau.getByRole('button', {name: heroLabel(locale, MATCH_QUESTION), exact: true});
        await expect(sixieme).toBeVisible();
        await expect(sixieme).toBeEnabled();
        await expect(sixieme).toBeFocused();
        await expect(await ouvrirZone(panneau, locale)).toHaveValue('');
        await expect(compte(panneau)).toHaveAttribute('data-ad-count', '0');
      });
    }

    test('« Retour » depuis la zone : les puces reviennent, le texte collé est abandonné, le focus sur la sixième', async ({
      page
    }) => {
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
      let appels = 0;
      page.on('request', (request) => {
        if (request.url().endsWith('/api/match')) appels += 1;
      });

      const zone = await ouvrirZone(panneau, 'fr');
      await zone.fill('Un texte que le visiteur abandonne.');
      await panneau.getByRole('button', {name: messages.fr.assistant.matchBack, exact: true}).click();

      const sixieme = panneau.getByRole('button', {name: heroLabel('fr', MATCH_QUESTION), exact: true});
      await expect(sixieme).toBeVisible();
      await expect(sixieme).toBeFocused();
      await expect(panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true})).toBeEnabled();
      await expect(await champLibre(panneau, 'fr')).toBeEnabled();
      // Rouverte, la zone est vide, et rien n'est parti.
      await expect(await ouvrirZone(panneau, 'fr')).toHaveValue('');
      await expect(compte(panneau)).toHaveAttribute('data-ad-count', '0');
      expect(appels).toBe(0);
    });
  });
}

test.describe('une marque invalide', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('est retirée du flux et des sources : citation_ok = 0, la ligne des sources ne compte que les valides', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    await capturerLeFlux(page);
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const attendu = scenarios.matchInvalid.fr;

    const ad = annonceFictive('fr', testInfo.testId.slice(-8), ` ${scenarios.markers.invalid}`);
    const appel = coller(page, panneau, 'fr', ad);
    const etats = await observerLeFlux(page, panneau);
    await appel;
    const [flux] = await fluxCaptures(page);
    const done = decoder(flux!).at(-1) as {type: string; sources: string[]; exchangeId: string};

    expect(done).toMatchObject({type: 'done', sources: attendu.sources});
    expect(flux).not.toContain('inexistante');
    sansMarqueNiBloc(flux!);
    for (const etat of etats) sansIdentifiant(etat.text);
    await expect(panneau.getByText(ligneDesSources('fr', attendu.sources.length), {exact: true})).toBeVisible();
    expect(exchange(done.exchangeId)).toMatchObject({
      kind: 'match',
      status: 'done',
      question: ad,
      answer: attendu.text,
      citation_ok: 0,
      cost_micro_usd: expectedCost(attendu.usage)
    });
    expect(JSON.parse(exchange(done.exchangeId)!.sources!)).toEqual(attendu.sources);
    const [requete] = (await requetesDuSimulateur()).filter((candidate) => candidate.ad === ad);
    expect(requete?.scenario).toBe('match-invalid');
  });
});

test.describe('une évaluation interrompue', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('garde le texte partiel sous son titre, le dit avec le contact, et laisse revenir', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    await capturerLeFlux(page);
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    const sessionId = sessionDuContexte(await context.cookies());
    const panneau = await ouvrirPanneau(page, 'fr', 1440);

    const ad = annonceFictive('fr', testInfo.testId.slice(-8), ` ${scenarios.markers.error}`);
    const response = await coller(page, panneau, 'fr', ad);
    expect(response.status()).toBe(200);

    // Interrompue, sous le titre de l'évaluation : le début de la première partie, sans la marque coupée.
    const zone = panneau.locator('[data-answer="interrupted"][data-kind="match"]');
    await expect(zone).toBeVisible();
    await expect(panneau.getByRole('heading', {level: 3})).toHaveText(messages.fr.assistant.matchTitle);
    await expect(zone.locator('strong')).toHaveText(MATCH_TITLES.fr.strengths);
    await expect(zone).toContainText('Dix ans sur un outil fictif');
    sansIdentifiant(await zone.innerText());
    const [flux] = await fluxCaptures(page);
    expect(decoder(flux!).map((event) => event.type)).toEqual(['delta', 'delta', 'error']);
    sansMarqueNiBloc(flux!);
    const alerte = panneau.getByRole('alert');
    await expect(alerte).toContainText(messages.fr.errors.model_unavailable);
    await expect(alerte.getByRole('link', {name: messages.fr.sections.contact})).toHaveAttribute('href', '#contact');
    await expect(panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true})).toBeVisible();
    await expect(await champLibre(panneau, 'fr')).toBeEnabled();

    // Journalisé : `match`, `model_error`, l'annonce, le texte partiel sans la marque ouverte.
    const [ligne] = exchangesOfSession(sessionId);
    expect(ligne).toMatchObject({kind: 'match', status: 'model_error', question: ad, citation_ok: null});
    expect(ligne!.answer).toMatch(/^\*\*Points forts\*\*\n- Dix ans sur un outil fictif/);
    sansIdentifiant(ligne!.answer!);
    const [requete] = (await requetesDuSimulateur()).filter((candidate) => candidate.ad === ad);
    expect(requete?.scenario).toBe('match-error');

    // Retour : les puces reviennent.
    await panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true}).click();
    await expect(panneau.getByRole('button', {name: heroLabel('fr', MATCH_QUESTION), exact: true})).toBeEnabled();
  });
});

test.describe('les refus, chacun avec son message, la zone gardée', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('rate_limited, no_visitor, invalid_input : un message ; cap_reached, model_unavailable : le contact en plus ; le texte collé reste, la zone a le focus', async ({
    page
  }) => {
    const cas: [number, string, string, boolean][] = [
      [429, 'rate_limited', messages.fr.errors.rate_limited, false],
      [401, 'no_visitor', messages.fr.errors.no_visitor, false],
      [400, 'invalid_input', messages.fr.errors.invalid_input, false],
      [503, 'cap_reached', messages.fr.errors.cap_reached, true],
      [503, 'model_unavailable', messages.fr.errors.model_unavailable, true],
      // Une raison inconnue, ou un corps qui n'en est pas un : le message générique.
      [500, 'autre', messages.fr.errors.unavailable, false]
    ];
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const zone = await ouvrirZone(panneau, 'fr');
    const ad = 'Annonce fictive refusée, huit fois collée une seule.';
    await zone.fill(ad);

    for (const [status, reason, attendu, contact] of cas) {
      await page.route('**/api/match', (route) =>
        route.fulfill({status, contentType: 'application/json', body: JSON.stringify({ok: false, reason})})
      );
      await panneau.getByRole('button', {name: messages.fr.assistant.matchSend, exact: true}).click();

      const alerte = panneau.getByRole('alert');
      await expect(alerte).toContainText(attendu);
      const lien = alerte.getByRole('link', {name: messages.fr.sections.contact});
      await expect(lien).toHaveCount(contact ? 1 : 0);
      if (contact) await expect(lien).toHaveAttribute('href', '#contact');
      // La zone est restée, son texte avec elle, le focus dessus ; tout est réactivé.
      await expect(zone).toBeVisible();
      await expect(zone).toHaveValue(ad);
      await expect(zone).toBeEnabled();
      await expect(zone).toBeFocused();
      await expect(compte(panneau)).toHaveAttribute('data-ad-count', String(ad.length));
      await expect(panneau.getByRole('button', {name: messages.fr.assistant.matchSend, exact: true})).toBeEnabled();
      await page.unroute('**/api/match');
    }

    // « Retour » abandonne le texte comme avant ; les puces sont là.
    await panneau.getByRole('button', {name: messages.fr.assistant.matchBack, exact: true}).click();
    await expect(panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true})).toBeEnabled();
    await expect(panneau.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('la zone', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('refuse la saisie au-delà de huit mille caractères, sans couper un emoji, et affiche le compte', async ({page}) => {
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const zone = await ouvrirZone(panneau, 'fr');
    const emoji = String.fromCodePoint(0x1f600);
    expect(emoji.length).toBe(2);

    await zone.fill('x'.repeat(AD_MAX_CHARS + 1));
    await expect(zone).toHaveJSProperty('value', 'x'.repeat(AD_MAX_CHARS));
    await expect(zone).toHaveAttribute('maxlength', String(AD_MAX_CHARS));
    await expect(compte(panneau)).toHaveAttribute('data-ad-count', String(AD_MAX_CHARS));
    await expect(compte(panneau)).toContainText(String(AD_MAX_CHARS));
    // Une frappe de plus ne passe pas.
    await zone.press('End');
    await zone.press('y');
    await expect(zone).toHaveJSProperty('value', 'x'.repeat(AD_MAX_CHARS));

    // Un emoji à cheval sur la borne part entier : la coupe recule d'une unité.
    await zone.fill(`${'x'.repeat(AD_MAX_CHARS - 1)}${emoji}`);
    await expect(zone).toHaveJSProperty('value', 'x'.repeat(AD_MAX_CHARS - 1));
    await expect(compte(panneau)).toHaveAttribute('data-ad-count', String(AD_MAX_CHARS - 1));
    // Un emoji qui tient juste dans la borne reste.
    await zone.fill(`${'x'.repeat(AD_MAX_CHARS - 2)}${emoji}`);
    await expect(zone).toHaveJSProperty('value', `${'x'.repeat(AD_MAX_CHARS - 2)}${emoji}`);
    await expect(compte(panneau)).toHaveAttribute('data-ad-count', String(AD_MAX_CHARS));
  });

  test('pendant le flux, zone, bouton, puces et champ libre sont hors de portée ; un second envoi ne part pas ; retour possible après', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    let appels = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/match')) appels += 1;
    });

    const zone = await ouvrirZone(panneau, 'fr');
    await zone.fill(annonceFictive('fr', testInfo.testId.slice(-8)));
    await panneau.getByRole('button', {name: messages.fr.assistant.matchSend, exact: true}).click();

    // La zone et son bouton ont laissé place à la réponse ; le champ libre
    // est désactivé ; aucune puce n'est là pour être cliquée.
    await expect(panneau.getByRole('heading', {level: 3})).toHaveText(messages.fr.assistant.matchTitle);
    await expect(zoneDe(panneau, 'fr')).toHaveCount(0);
    await expect(panneau.getByRole('button', {name: messages.fr.assistant.matchSend, exact: true})).toHaveCount(0);
    const champ = panneau.getByRole('textbox', {name: messages.fr.assistant.questionLabel});
    await expect(champ).toBeDisabled();
    await expect(panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true})).toHaveCount(0);
    await champ.press('Enter');

    await expect(panneau.locator('[data-answer="answered"]')).toBeVisible();
    await expect(champ).toBeEnabled();
    await expect(panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true})).toBeVisible();
    expect(appels).toBe(1);
  });
});

test.describe('sans JavaScript', () => {
  test.use({javaScriptEnabled: false});

  for (const {name, viewport} of VIEWPORTS) {
    test.describe(name, () => {
      test.use({viewport});

      test('la sixième puce reste désactivée et la ligne dʼétat est inchangée', async ({page}) => {
        await page.goto('/fr');
        const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
        const sixieme = panneau.getByRole('button', {name: heroLabel('fr', MATCH_QUESTION), exact: true});
        await expect(sixieme).toBeVisible();
        await expect(sixieme).toBeDisabled();
        await expect(zoneDe(panneau, 'fr')).toHaveCount(0);
        await expect(panneau.getByText(messages.fr.assistant.withoutScript)).toBeVisible();
      });
    });
  }
});

test.describe('le préfixe de cache et lʼhistorique', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('une question puis une annonce portent le même sha de bloc système ; la question suivante rejoue lʼannonce par son repère', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    const sessionId = sessionDuContexte(await context.cookies());
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const marque = testInfo.testId.slice(-8);

    // 1. Une question libre.
    const premiere = `Première question avant lʼannonce ${marque}`;
    await poser(page, panneau, 'fr', premiere);
    await expect(panneau.locator('[data-answer="answered"]')).toBeVisible();
    await panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true}).click();

    // 2. Une annonce, dans la même session.
    const ad = annonceFictive('fr', marque);
    await coller(page, panneau, 'fr', ad);
    await expect(panneau.locator('[data-answer="answered"][data-kind="match"]')).toBeVisible();
    await panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true}).click();

    // 3. Une question libre après l'évaluation.
    const seconde = `Seconde question après lʼannonce ${marque}`;
    await poser(page, panneau, 'fr', seconde);
    await expect(panneau.locator('[data-answer="answered"][data-kind="chat"]')).toBeVisible();

    const requetes = await requetesDuSimulateur();
    const a = requetes.find((requete) => requete.question === premiere)!;
    const b = requetes.find((requete) => requete.ad === ad)!;
    const c = requetes.find((requete) => requete.question === seconde)!;
    expect(a?.systemSha).toBeDefined();
    // Identique octet pour octet, question ou annonce : un seul préfixe de cache.
    expect(b?.systemSha).toBe(a?.systemSha);
    expect(c?.systemSha).toBe(a?.systemSha);
    // L'annonce porte l'historique de la question ; la seconde question, celui des deux tours.
    expect(a.messages).toBe(1);
    expect(b.messages).toBe(3);
    expect(c.messages).toBe(5);
    // Le tour match est rejoué par son repère, pas par l'annonce ; sa réponse, sans marques ni bloc.
    const tours = c.turns!;
    expect(tours.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(tours[0]!.head).toBe(premiere);
    expect(tours[2]!.head).toBe(MESSAGE_LABELS.fr.matchTurn);
    expect(tours[3]!.head.startsWith(`**${MATCH_TITLES.fr.strengths}**`)).toBe(true);
    for (const turn of tours) {
      expect(turn.head).not.toContain('Annonce fictive');
      sansIdentifiant(turn.head);
    }

    // En base : chat, match, chat — l'annonce entière conservée une fois.
    const lignes = exchangesOfSession(sessionId);
    expect(lignes.map((ligne) => [ligne.kind, ligne.status])).toEqual([
      ['chat', 'done'],
      ['match', 'done'],
      ['chat', 'done']
    ]);
    expect(lignes[1]!.question).toBe(ad);
  });
});
