import {expect, test} from '@playwright/test';
import {createSseDecoder} from '../../src/app/_lib/chat-contract';
import {MONTHLY_CAP_MICRO_USD} from '../../src/agent/pricing';
import {
  adressePropre,
  capturerLeFlux,
  champLibre,
  fluxCaptures,
  exchange,
  exchangesOfSession,
  expectedCost,
  lire,
  messages,
  ouvrirPanneau,
  poser,
  scenarios,
  sessionDuContexte,
  stubURL
} from './chat-helpers';

/**
 * Le plafond de dépense (CAP-8, AD-6), **en dernier et isolé** : ce fichier
 * n'est joué que par le projet `chromium-plafond`, qui dépend du projet
 * principal. Une fois qu'une réponse a déclaré un `usage` qui vaut plus de
 * 5 USD, `usage.db` porte un cumul du mois au-dessus du plafond, et plus
 * aucune question ne peut partir — jusqu'à ce que `playwright.config.ts`
 * recrée la base à l'exécution suivante.
 */
test.use({viewport: {width: 1440, height: 900}});

test('après une réponse qui vaut plus que le plafond, la question suivante est refusée cap_reached, avec le contact, et journalisée', async ({
  page,
  context
}, testInfo) => {
  await adressePropre(context, testInfo);
  await capturerLeFlux(page);
  await page.goto('/fr');
  await page.waitForLoadState('networkidle');
  const sessionId = sessionDuContexte(await context.cookies());
  const panneau = await ouvrirPanneau(page, 'fr', 1440);

  // 1. La réponse coûteuse : servie normalement, son coût réel en base.
  const couteuse = `Question ${scenarios.markers.cap} ${testInfo.testId.slice(-8)}`;
  const response = await poser(page, panneau, 'fr', couteuse);
  expect(response.status()).toBe(200);
  await expect(panneau.locator('[data-answer="answered"]')).toHaveText(scenarios.cap.text);
  const [flux] = await fluxCaptures(page);
  const sse = createSseDecoder();
  const events = [...sse.push(flux!), ...sse.end()];
  const done = events.at(-1) as {type: string; exchangeId: string};
  expect(done.type).toBe('done');
  const cout = expectedCost(scenarios.cap.usage);
  expect(cout).toBeGreaterThan(MONTHLY_CAP_MICRO_USD);
  expect(exchange(done.exchangeId)).toMatchObject({status: 'done', cost_micro_usd: cout});
  // Le cumul du mois — la somme sur `exchange`, pas un compteur — dépasse le plafond.
  const [{total}] = lire<{total: number}>('SELECT coalesce(sum(cost_micro_usd), 0) AS total FROM exchange');
  expect(total).toBeGreaterThan(MONTHLY_CAP_MICRO_USD);

  // 2. La question suivante : refusée avant tout appel, le panneau renvoie au contact.
  await panneau.getByRole('button', {name: messages.fr.assistant.back, exact: true}).click();
  const refusee = `Question après le plafond ${testInfo.testId.slice(-8)}`;
  const refus = await poser(page, panneau, 'fr', refusee);
  expect(refus.status()).toBe(503);
  expect(await refus.json()).toEqual({ok: false, reason: 'cap_reached'});

  const alerte = panneau.getByRole('alert');
  await expect(alerte).toContainText(messages.fr.errors.cap_reached);
  const lien = alerte.getByRole('link', {name: messages.fr.sections.contact});
  await expect(lien).toHaveAttribute('href', '#contact');
  await expect(page.locator('#contact')).toHaveCount(1);
  await expect(await champLibre(panneau, 'fr')).toBeEnabled();

  // 3. Journalisé : une ligne `cap_reached`, coût nul, la question conservée, rien d'autre.
  const lignes = exchangesOfSession(sessionId);
  expect(lignes.map((ligne) => ligne.status)).toEqual(['done', 'cap_reached']);
  expect(lignes[1]).toMatchObject({
    kind: 'chat',
    status: 'cap_reached',
    question: refusee,
    answer: null,
    sources: null,
    citation_ok: null,
    input_tokens: null,
    output_tokens: null,
    cost_micro_usd: 0,
    latency_ms: null
  });

  // 4. Le simulateur n'a pas été appelé pour la question refusée.
  const requetes = (await (await fetch(`${stubURL}/requests`)).json()) as {question?: string | null}[];
  expect(requetes.some((requete) => requete.question === refusee)).toBe(false);
  expect(requetes.some((requete) => requete.question === couteuse)).toBe(true);
});
