import IntlMessageFormat from 'intl-messageformat';
import {expect, test, type Locator, type Page} from '@playwright/test';
import {createSseDecoder, type ChatEvent} from '../../src/app/_lib/chat-contract';
import {reservationMicroUsd} from '../../src/agent/pricing';
import {
  adressePropre,
  capturerLeFlux,
  champLibre,
  fluxCaptures,
  exchange,
  exchangesOfSession,
  expectedCost,
  messages,
  ouvrirPanneau,
  poser,
  scenarios,
  sessionDuContexte,
  stubURL
} from './chat-helpers';
import {LANGS, type Lang} from './fixture-cv';
import {heroLabel} from './hero-labels';

/**
 * Preuve navigateur du champ libre (CAP-3, story 6), contre l'**artefact de
 * production** et le **simulateur** de l'API du modèle : le texte apparaît au
 * fil de l'eau, le bloc `<sources>` n'atteint jamais le navigateur, la ligne
 * des sources est là, et `usage.db` porte un `exchange` de sorte `chat` avec
 * les compteurs et le coût que le simulateur a déclarés — calculé par la même
 * table de prix que le serveur.
 *
 * Chaque test a son propre visiteur (contexte neuf) et sa propre adresse
 * (`X-Client-IP`) pour rester sous le limiteur ; le plafond, lui, vit dans
 * `chat-cap.spec.ts`, joué en dernier et isolé.
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

/** « d'après le dossier · 1 source », formaté comme la page le formate. */
function ligneDesSources(locale: Lang, count: number): string {
  const plural = String(new IntlMessageFormat(messages[locale].assistant.answerSources, locale).format({count}));
  return `${messages[locale].assistant.answerModel} · ${plural}`;
}

type Etat = {readonly state: string | null; readonly text: string; readonly panneau: string};

/**
 * Observe la zone de réponse pendant le flux, à haute fréquence, jusqu'à la
 * fin (`data-answer` ≠ `streaming`) ou l'échéance : chaque état distinct est
 * retenu. C'est ainsi qu'on voit le texte grandir — et qu'on vérifie qu'à
 * aucun moment le bloc n'a été visible.
 */
async function observer(page: Page, panneau: Locator, echeanceMs = 8000): Promise<Etat[]> {
  const etats: Etat[] = [];
  const echeance = Date.now() + echeanceMs;
  while (Date.now() < echeance) {
    // Un seul aller-retour, sans attente d'élément : la zone n'existe pas
    // encore avant le premier delta, et n'existe plus après le retour.
    const lu = await panneau.evaluate((section) => {
      const zone = section.querySelector<HTMLElement>('[data-answer]');
      return {
        state: zone?.getAttribute('data-answer') ?? null,
        text: zone?.innerText ?? '',
        panneau: (section as HTMLElement).innerText
      };
    });
    const dernier = etats.at(-1);
    if (dernier === undefined || dernier.state !== lu.state || dernier.text !== lu.text) etats.push(lu);
    if (lu.state !== null && lu.state !== 'streaming') break;
    await page.waitForTimeout(10);
  }
  return etats;
}

/** Les requêtes que le simulateur a reçues pour une question — reconnues à sa fin. */
async function requetesDuSimulateur(question: string) {
  const toutes = (await (await fetch(`${stubURL}/requests`)).json()) as {
    scenario?: string;
    fault?: string;
    model?: string;
    max_tokens?: number;
    effort?: string;
    systemSha?: string;
    cacheControl?: {type: string};
    messages?: number;
    question?: string | null;
  }[];
  return toutes.filter((requete) => requete.question === question);
}

for (const {name, viewport} of VIEWPORTS) {
  test.describe(name, () => {
    test.use({viewport});

    for (const locale of LANGS) {
      test(`/${locale} : le texte arrive au fil de lʼeau, sans bloc, et lʼéchange chat est en base avec ses compteurs`, async ({
        page,
        context
      }, testInfo) => {
        await adressePropre(context, testInfo);
        await capturerLeFlux(page);
        await page.goto(`/${locale}`);
        await page.waitForLoadState('networkidle');
        const sessionId = sessionDuContexte(await context.cookies());
        const panneau = await ouvrirPanneau(page, locale, viewport.width);

        // D'abord une puce : cet échange fera partie de l'historique de la question.
        await panneau.getByRole('button', {name: heroLabel(locale, 'lic-01'), exact: true}).click();
        await expect(panneau.getByRole('heading', {level: 3})).toBeVisible();
        await panneau.getByRole('button', {name: messages[locale].assistant.back, exact: true}).click();

        const question = `Question libre ${locale} ${viewport.width} ${testInfo.testId.slice(-8)}`;
        const appel = poser(page, panneau, locale, question);
        const etats = await observer(page, panneau);
        const response = await appel;

        // Le flux : 200, event-stream, delta… puis done avec la seule source valide.
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('text/event-stream');
        expect(response.headers()['cache-control']).toContain('no-store');
        const [flux] = await fluxCaptures(page);
        const events = decoder(flux!);
        const done = events.at(-1);
        expect(done).toMatchObject({type: 'done', sources: scenarios.ordinary.sources});
        const exchangeId = (done as {exchangeId: string}).exchangeId;
        expect(exchangeId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        const deltas = events.filter((event): event is Extract<ChatEvent, {type: 'delta'}> => event.type === 'delta');
        expect(deltas.length).toBeGreaterThanOrEqual(2);
        expect(deltas.map((event) => event.text).join('')).toBe(`${scenarios.ordinary.text}\n\n`);
        expect(JSON.stringify(events)).not.toContain('sources>');

        // Au fil de l'eau : au moins deux états intermédiaires du texte, avant la fin.
        const intermediaires = etats.filter((etat) => etat.state === 'streaming' && etat.text !== '');
        expect(intermediaires.length, 'au moins deux états intermédiaires observés').toBeGreaterThanOrEqual(2);
        expect(intermediaires[0]!.text.length).toBeLessThan(intermediaires.at(-1)!.text.length);
        // Et jamais le bloc, ni un fragment de lui, dans le panneau.
        for (const etat of etats) {
          expect(etat.panneau).not.toContain('<sour');
          expect(etat.panneau).not.toContain('sources>');
          expect(etat.panneau).not.toContain('qa:lic-01');
        }
        expect(etats.at(-1)!.state).toBe('answered');

        // Le rendu final : la question en titre, le Markdown rendu, la ligne des sources.
        await expect(panneau.getByRole('heading', {level: 3})).toHaveText(question);
        const zone = panneau.locator('[data-answer="answered"]');
        await expect(zone.locator('strong')).toHaveText('simulée');
        await expect(zone.locator('ul li')).toHaveCount(2);
        await expect(zone).toContainText('Reponse-simulee');
        expect(await zone.innerText()).not.toMatch(/\*\*|\n- /);
        await expect(
          panneau.getByText(ligneDesSources(locale, scenarios.ordinary.sources.length), {exact: true})
        ).toBeVisible();
        expect(await panneau.innerText()).not.toContain('<');

        // Journalisé : `chat`, `done`, la question, la réponse sans bloc, les
        // sources déclarées — toutes valides, `citation_ok = 1` —, les quatre
        // compteurs et le coût du simulateur.
        const ligne = exchange(exchangeId);
        expect(ligne, 'lʼéchange doit être en base').toBeDefined();
        expect(ligne).toMatchObject({
          session_id: sessionId,
          kind: 'chat',
          status: 'done',
          question,
          answer: scenarios.ordinary.text,
          citation_ok: 1,
          input_tokens: scenarios.ordinary.usage.input_tokens,
          output_tokens: scenarios.ordinary.usage.output_tokens,
          cache_read_tokens: scenarios.ordinary.usage.cache_read_input_tokens,
          cache_creation_tokens: scenarios.ordinary.usage.cache_creation_input_tokens,
          cost_micro_usd: expectedCost(scenarios.ordinary.usage)
        });
        expect(JSON.parse(ligne!.sources!)).toEqual(scenarios.ordinary.sources);
        expect(ligne!.latency_ms).toBeGreaterThanOrEqual(0);

        // Ce que le simulateur a reçu : ce qu'AD-6 impose, et l'historique de
        // la session devant la question (la puce cliquée : un tour de plus).
        const [requete] = await requetesDuSimulateur(question);
        expect(requete).toMatchObject({
          scenario: 'ordinary',
          model: 'claude-opus-5',
          max_tokens: 1200,
          effort: 'low',
          cacheControl: {type: 'ephemeral'},
          messages: 3
        });

        // Retour aux questions : le champ garde le focus, les puces reviennent.
        await panneau.getByRole('button', {name: messages[locale].assistant.back, exact: true}).click();
        await expect(panneau.getByRole('button', {name: heroLabel(locale, 'lic-01'), exact: true})).toBeVisible();
        await expect(await champLibre(panneau, locale)).toBeFocused();
      });
    }

    test('une source invalide déclarée est retirée : citation_ok = 0, la ligne des sources ne compte que les valides', async ({
      page,
      context
    }, testInfo) => {
      await adressePropre(context, testInfo);
      await capturerLeFlux(page);
      await page.goto('/fr');
      await page.waitForLoadState('networkidle');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);

      const question = `Question ${scenarios.markers.invalid} ${testInfo.testId.slice(-8)}`;
      const appel = poser(page, panneau, 'fr', question);
      const etats = await observer(page, panneau);
      await appel;
      const [flux] = await fluxCaptures(page);
      const done = decoder(flux!).at(-1) as {type: string; sources: string[]; exchangeId: string};

      expect(done).toMatchObject({type: 'done', sources: scenarios.invalid.sources});
      // Ni le bloc ni la source invalide n'atteignent le navigateur — ni le flux, ni l'écran.
      expect(flux).not.toContain('inexistante');
      for (const etat of etats) expect(etat.panneau).not.toContain('inexistante');
      await expect(panneau.getByText(ligneDesSources('fr', scenarios.invalid.sources.length), {exact: true})).toBeVisible();
      expect(exchange(done.exchangeId)).toMatchObject({
        status: 'done',
        answer: scenarios.invalid.text,
        citation_ok: 0,
        cost_micro_usd: expectedCost(scenarios.invalid.usage)
      });
      expect(JSON.parse(exchange(done.exchangeId)!.sources!)).toEqual(scenarios.invalid.sources);
    });

    test('une erreur en cours de flux garde le texte partiel, le dit, et renvoie au contact', async ({
      page,
      context
    }, testInfo) => {
      await adressePropre(context, testInfo);
      await capturerLeFlux(page);
      await page.goto('/fr');
      await page.waitForLoadState('networkidle');
      const sessionId = sessionDuContexte(await context.cookies());
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);

      const question = `Question ${scenarios.markers.error} ${testInfo.testId.slice(-8)}`;
      const response = await poser(page, panneau, 'fr', question);
      expect(response.status()).toBe(200);

      // Le texte partiel reste, le message est là, avec le lien vers le contact.
      const zone = panneau.locator('[data-answer="interrupted"]');
      await expect(zone).toHaveText(scenarios.error.text);
      const [flux] = await fluxCaptures(page);
      expect(decoder(flux!).map((event) => event.type)).toEqual(['delta', 'delta', 'error']);
      const alerte = panneau.getByRole('alert');
      await expect(alerte).toContainText(messages.fr.errors.model_unavailable);
      const lien = alerte.getByRole('link', {name: messages.fr.header.contact});
      await expect(lien).toHaveAttribute('href', '#contact');
      await expect(page.locator('#contact')).toHaveCount(1);
      await expect(await champLibre(panneau, 'fr')).toBeEnabled();

      // Journalisé : `model_error`, le texte partiel, sans source, la réservation en coût.
      const [ligne] = exchangesOfSession(sessionId);
      expect(ligne).toMatchObject({
        kind: 'chat',
        status: 'model_error',
        question,
        answer: scenarios.error.text,
        citation_ok: null,
        input_tokens: null,
        output_tokens: null
      });
      expect(JSON.parse(ligne!.sources!)).toEqual([]);
      // La réservation : l'entrée estimée au prix plein plus 1 200 jetons de sortie — au moins ça.
      expect(ligne!.cost_micro_usd).toBeGreaterThanOrEqual(reservationMicroUsd(0));
    });

    test('pendant le flux, puces et champ sont désactivés ; un second envoi ne part pas', async ({
      page,
      context
    }, testInfo) => {
      await adressePropre(context, testInfo);
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
      let appels = 0;
      page.on('request', (request) => {
        if (request.url().endsWith('/api/chat')) appels += 1;
      });

      const champ = await champLibre(panneau, 'fr');
      await champ.fill('Question pendant le flux');
      await champ.press('Enter');

      await expect(champ).toBeDisabled();
      await expect(panneau.getByRole('button', {name: messages.fr.assistant.send})).toBeDisabled();
      await champ.press('Enter');
      await expect(panneau.locator('[data-answer="answered"]')).toBeVisible();
      await expect(champ).toBeEnabled();
      expect(appels).toBe(1);
    });
  });
}

test.describe('les refus, chacun avec son message', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('rate_limited, no_visitor, invalid_input : un message ; cap_reached, model_unavailable : le contact en plus', async ({
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

    for (const [status, reason, attendu, contact] of cas) {
      await page.route('**/api/chat', (route) =>
        route.fulfill({status, contentType: 'application/json', body: JSON.stringify({ok: false, reason})})
      );
      const champ = await champLibre(panneau, 'fr');
      await champ.fill(`Question refusée ${reason}`);
      await champ.press('Enter');

      const alerte = panneau.getByRole('alert');
      await expect(alerte).toContainText(attendu);
      const lien = alerte.getByRole('link', {name: messages.fr.header.contact});
      await expect(lien).toHaveCount(contact ? 1 : 0);
      if (contact) await expect(lien).toHaveAttribute('href', '#contact');
      // Tout se réactive, le focus revient au champ, les puces sont restées.
      await expect(champ).toBeEnabled();
      await expect(champ).toBeFocused();
      await expect(panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true})).toBeEnabled();
      await page.unroute('**/api/chat');
    }
  });
});

test.describe('une réflexion longue', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('douze secondes sans delta : le battement de cœur passe, le panneau ne tombe pas en erreur', async ({
    page,
    context
  }, testInfo) => {
    test.setTimeout(60_000);
    await adressePropre(context, testInfo);
    await capturerLeFlux(page);
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);

    const question = `Question ${scenarios.markers.slow} ${testInfo.testId.slice(-8)}`;
    await poser(page, panneau, 'fr', question);
    // Pendant l'attente : l'attente, pas une alerte.
    await expect(panneau.getByRole('status')).toHaveText(messages.fr.assistant.loading);
    await expect(panneau.locator('[data-answer="answered"]')).toHaveText(scenarios.slow.text, {
      timeout: scenarios.slow.initialDelayMs + 10_000
    });
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    // Le battement de cœur a bien traversé Next et le navigateur : au moins un
    // commentaire `: ping` dans ce que la page a reçu, avant le premier delta.
    const [flux] = await fluxCaptures(page);
    expect(flux).toMatch(/^: ping\n\n/);
    expect(flux!.indexOf(': ping')).toBeLessThan(flux!.indexOf('event: delta'));
  });
});

test.describe('le client parti', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('lʼonglet fermé pendant le flux : lʼappel va à son terme, lʼéchange est done avec ses compteurs', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    const sessionId = sessionDuContexte(await context.cookies());
    const panneau = await ouvrirPanneau(page, 'fr', 1440);

    const question = `Question ${scenarios.markers.spaced} ${testInfo.testId.slice(-8)}`;
    await poser(page, panneau, 'fr', question);
    // Le premier morceau est là ; les suivants sont espacés : on ferme au milieu.
    await expect(panneau.locator('[data-answer="streaming"]')).toContainText(scenarios.spaced.deltas[0]!.trim());
    await page.close();

    // Le serveur, lui, continue : la ligne passe de pending à done, seule.
    const echeance = Date.now() + scenarios.spaced.spacingMs * scenarios.spaced.deltas.length + 10_000;
    let ligne = exchangesOfSession(sessionId)[0];
    while ((ligne === undefined || ligne.status === 'pending') && Date.now() < echeance) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      ligne = exchangesOfSession(sessionId)[0];
    }
    expect(ligne).toMatchObject({
      kind: 'chat',
      status: 'done',
      question,
      answer: scenarios.spaced.text,
      citation_ok: 1,
      input_tokens: scenarios.spaced.usage.input_tokens,
      output_tokens: scenarios.spaced.usage.output_tokens,
      cache_read_tokens: scenarios.spaced.usage.cache_read_input_tokens,
      cost_micro_usd: expectedCost(scenarios.spaced.usage)
    });
  });
});

test.describe('un flux qui se ferme sans done ni error', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('après un delta : interrompu, le texte reste, le message le dit, le champ et le retour reviennent', async ({page}) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 200,
        headers: {'content-type': 'text/event-stream; charset=utf-8'},
        body: 'event: delta\ndata: {"text":"Un seul morceau."}\n\n'
      })
    );
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const champ = await champLibre(panneau, 'fr');
    await champ.fill('Question coupée');
    await champ.press('Enter');

    await expect(panneau.locator('[data-answer="interrupted"]')).toHaveText('Un seul morceau.');
    await expect(panneau.getByRole('alert')).toHaveText(messages.fr.errors.unavailable);
    await expect(champ).toBeEnabled();
    await expect(panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true})).toBeVisible();
  });

  test('sans rien : un échec, pas une réponse vide interrompue', async ({page}) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({status: 200, headers: {'content-type': 'text/event-stream; charset=utf-8'}, body: ''})
    );
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const champ = await champLibre(panneau, 'fr');
    await champ.fill('Question sans réponse');
    await champ.press('Enter');

    await expect(panneau.getByRole('alert')).toHaveText(messages.fr.errors.unavailable);
    await expect(panneau.locator('[data-answer]')).toHaveCount(0);
    await expect(panneau.getByRole('heading', {level: 3})).toHaveCount(0);
    await expect(champ).toBeEnabled();
    await expect(champ).toBeFocused();
    await expect(panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true})).toBeEnabled();
  });
});

test.describe('une route muette', () => {
  // Une fois, sur une seule largeur : le silence vaut trente secondes réelles.
  test.use({viewport: {width: 1440, height: 900}});

  test('trente secondes sans événement : le message dʼindisponibilité, le champ réactivé', async ({page}) => {
    test.setTimeout(60_000);
    await page.route('**/api/chat', () => {});
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const champ = await champLibre(panneau, 'fr');

    await champ.fill('Question sans réponse');
    await champ.press('Enter');
    await expect(panneau.getByRole('status')).toHaveText(messages.fr.assistant.loading);

    await expect(panneau.getByRole('alert')).toHaveText(messages.fr.errors.unavailable, {timeout: 35_000});
    await expect(champ).toBeEnabled();
  });
});

test.describe('sans JavaScript', () => {
  test.use({javaScriptEnabled: false});

  for (const {name, viewport} of VIEWPORTS) {
    test.describe(name, () => {
      test.use({viewport});

      test('le champ libre reste désactivé et la ligne dʼétat dit quʼil faut JavaScript', async ({page}) => {
        await page.goto('/fr');
        const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
        const champ = panneau.getByRole('textbox', {name: messages.fr.assistant.questionLabel});
        await expect(champ).toBeVisible();
        await expect(champ).toBeDisabled();
        await expect(panneau.getByRole('button', {name: messages.fr.assistant.send})).toBeDisabled();
        await expect(panneau.getByText(messages.fr.assistant.withoutScript)).toBeVisible();
        await expect(panneau.getByText(messages.fr.assistant.inactive)).toHaveCount(0);
      });
    });
  }
});

test.describe('le préfixe de cache', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('deux questions dans la même langue portent le même bloc système ; lʼautre langue, un autre', async ({
    page,
    context
  }, testInfo) => {
    await adressePropre(context, testInfo);
    const marque = testInfo.testId.slice(-8);

    await page.goto('/fr');
    const panneauFr = await ouvrirPanneau(page, 'fr', 1440);
    const premiere = `Première question cache ${marque}`;
    await poser(page, panneauFr, 'fr', premiere);
    await expect(panneauFr.locator('[data-answer="answered"]')).toBeVisible();
    await panneauFr.getByRole('button', {name: messages.fr.assistant.back, exact: true}).click();
    const seconde = `Seconde question cache ${marque}`;
    await poser(page, panneauFr, 'fr', seconde);
    await expect(panneauFr.locator('[data-answer="answered"]')).toBeVisible();

    await page.goto('/en');
    const panneauEn = await ouvrirPanneau(page, 'en', 1440);
    const anglaise = `English cache question ${marque}`;
    await poser(page, panneauEn, 'en', anglaise);
    await expect(panneauEn.locator('[data-answer="answered"]')).toBeVisible();

    const [a] = await requetesDuSimulateur(premiere);
    const [b] = await requetesDuSimulateur(seconde);
    const [c] = await requetesDuSimulateur(anglaise);
    expect(a?.systemSha).toBeDefined();
    // Identique octet pour octet : c'est ce que le cache de l'API lit (la preuve réelle, `cache_read_input_tokens > 0`, est en story 10).
    expect(b?.systemSha).toBe(a?.systemSha);
    expect(c?.systemSha).not.toBe(a?.systemSha);
    // La seconde question porte l'historique de la première : un tour de plus.
    expect(a?.messages).toBe(1);
    expect(b?.messages).toBe(3);
  });
});
