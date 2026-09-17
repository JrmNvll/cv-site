/**
 * Ce que `chat.spec.ts`, `chat-cap.spec.ts` et `match.spec.ts` ont en commun :
 * le panneau visible, une adresse propre à chaque test, la lecture de
 * `usage.db`, les scénarios du simulateur, l'observation d'un flux, et le coût
 * attendu — calculé par la **même** table de prix que le serveur, jamais
 * recopié.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import IntlMessageFormat from 'intl-messageformat';
import {expect, type BrowserContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {costMicroUsd} from '../../src/agent/pricing';
import type {Lang} from './fixture-cv';

export const messages = {fr, en};
export const USAGE_DB = resolve(__dirname, '../fixtures/data/usage.db');
export const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** Les scénarios du simulateur — la même source que `model-stub/server.mjs`. */
type Answered = {deltas: string[]; text: string; sources: string[]; usage: Usage};

export const scenarios = JSON.parse(
  readFileSync(resolve(__dirname, 'model-stub/scenarios.json'), 'utf8')
) as {
  port: number;
  markers: {invalid: string; error: string; cap: string; slow: string; spaced: string};
  delayMs: number;
  ordinary: Answered;
  invalid: Answered;
  error: {deltas: string[]; text: string};
  cap: {deltas: string[]; text: string; usage: Usage};
  slow: Answered & {initialDelayMs: number};
  spaced: Answered & {spacingMs: number};
  /** L'évaluation d'une annonce, dans la langue des règles ; sa variante `[invalide]`. */
  match: Record<Lang, Answered>;
  matchInvalid: Record<Lang, Answered>;
};

/** Ce que le simulateur retient d'une requête (`GET /requests`). */
export type StubRequest = {
  scenario?: string;
  lang?: string;
  fault?: string;
  model?: string;
  max_tokens?: number;
  effort?: string;
  systemSha?: string;
  cacheControl?: {type: string};
  messages?: number;
  question?: string | null;
  ad?: string | null;
  turns?: {role: string; head: string}[];
};

/** Toutes les requêtes que le simulateur a reçues jusqu'ici. */
export async function requetesDuSimulateur(): Promise<StubRequest[]> {
  return (await (await fetch(`${stubURL}/requests`)).json()) as StubRequest[];
}

export const stubURL = `http://127.0.0.1:${process.env.MODEL_STUB_PORT || scenarios.port}`;

/** Le coût que le serveur doit avoir écrit pour un `usage` donné. */
export const expectedCost = (usage: Usage) => costMicroUsd(usage);

export type ExchangeRow = {
  id: string;
  session_id: string;
  kind: string;
  status: string;
  question: string;
  answer: string | null;
  sources: string | null;
  citation_ok: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_micro_usd: number | null;
  latency_ms: number | null;
  at: string;
};

/** Une connexion en lecture seule, le temps d'une requête : toujours l'état commis. */
export function lire<T>(sql: string, ...params: (string | number)[]): T[] {
  const db = new DatabaseSync(USAGE_DB, {readOnly: true});
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

export const exchange = (id: string) =>
  lire<ExchangeRow>(
    `SELECT id, session_id, kind, status, question, answer, sources, citation_ok,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            cost_micro_usd, latency_ms, at
     FROM exchange WHERE id = ?`,
    id
  )[0];

export const exchangesOfSession = (sessionId: string) =>
  lire<ExchangeRow>(
    `SELECT id, session_id, kind, status, question, answer, sources, citation_ok,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            cost_micro_usd, latency_ms, at
     FROM exchange WHERE session_id = ? ORDER BY at, id`,
    sessionId
  );

/** L'identifiant de session tel que le navigateur le tient — même lecture que `proxy.ts`. */
export function sessionDuContexte(cookies: {name: string; value: string}[]): string {
  const sessionId = cookies.find(({name}) => name === 'cv_session')?.value.split('.')[0];
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return sessionId!;
}

/**
 * Une adresse par test, posée en en-tête de contexte : le limiteur compte
 * 10 questions par 15 minutes par adresse, et tous les tests partageraient
 * sinon `unknown`. `203.0.<worker>.<n>` : un bloc de documentation, jamais
 * routé, une adresse valide pour `clientIp()`.
 */
let compteur = 0;
export async function adressePropre(context: BrowserContext, testInfo: TestInfo): Promise<string> {
  compteur = (compteur % 250) + 1;
  const ip = `203.0.${testInfo.parallelIndex % 250}.${compteur}`;
  await context.setExtraHTTPHeaders({'X-Client-IP': ip});
  return ip;
}

/**
 * Le panneau visible : sous `lg`, celui du tiroir, qu'on ouvre par la barre ;
 * au-dessus, celui du premier écran. `getByRole` ignore la copie masquée.
 */
export async function ouvrirPanneau(page: Page, locale: Lang, width: number): Promise<Locator> {
  const barre = page.locator('summary');
  if (width < 1024) {
    await expect(barre).toBeVisible();
    await barre.click();
  } else {
    await expect(barre).toBeHidden();
  }
  return page.getByRole('region', {name: messages[locale].assistant.eyebrow});
}

/** Le champ libre du panneau, actif une fois hydraté. */
export async function champLibre(panneau: Locator, locale: Lang): Promise<Locator> {
  const champ = panneau.getByRole('textbox', {name: messages[locale].assistant.questionLabel});
  await expect(champ).toBeEnabled();
  return champ;
}

/** Pose une question dans le champ et valide par Entrée ; rend la réponse HTTP de `/api/chat`. */
export async function poser(page: Page, panneau: Locator, locale: Lang, question: string) {
  const champ = await champLibre(panneau, locale);
  await champ.fill(question);
  const appel = page.waitForResponse((response) => response.url().endsWith('/api/chat'));
  await champ.press('Enter');
  return appel;
}

/**
 * Capture, **dans la page**, les octets que le navigateur reçoit de `/api/chat`
 * et de `/api/match`.
 *
 * Chromium ne rend pas à Playwright le corps d'une réponse que la page a lue
 * en flux (« No data found for resource ») : c'est donc la page qui garde une
 * copie, par un `fetch` dédoublé (`tee`), sans rien changer à ce que le
 * composant lit ni au rythme auquel il le lit. Un script de test, posé avant
 * le chargement — jamais du code de l'application.
 */
export async function capturerLeFlux(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.fetch;
    const captures: string[] = [];
    (window as unknown as {__flux: string[]}).__flux = captures;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!/\/api\/(chat|match)$/.test(url) || response.body === null) return response;
      const [pourLaPage, pourLeTest] = response.body.tee();
      const position = captures.push('') - 1;
      void (async () => {
        const reader = pourLeTest.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const {value, done} = await reader.read();
          if (done) break;
          captures[position] += decoder.decode(value, {stream: true});
        }
      })();
      return new Response(pourLaPage, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    };
  });
}

/** Les flux capturés jusqu'ici, dans l'ordre des appels. */
export function fluxCaptures(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as {__flux: string[]}).__flux ?? []);
}

/** « d'après le dossier · 1 source », formaté comme la page le formate. */
export function ligneDesSources(locale: Lang, count: number): string {
  const plural = String(new IntlMessageFormat(messages[locale].assistant.answerSources, locale).format({count}));
  return `${messages[locale].assistant.answerModel} · ${plural}`;
}

export type EtatDuFlux = {readonly state: string | null; readonly text: string; readonly panneau: string};

/**
 * Observe la zone de réponse pendant le flux, à haute fréquence, jusqu'à la
 * fin (`data-answer` ≠ `streaming`) ou l'échéance : chaque état distinct est
 * retenu. C'est ainsi qu'on voit le texte grandir — et qu'on vérifie qu'à
 * aucun moment le bloc, ou une marque, n'a été visible.
 */
export async function observerLeFlux(page: Page, panneau: Locator, echeanceMs = 8000): Promise<EtatDuFlux[]> {
  const etats: EtatDuFlux[] = [];
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
