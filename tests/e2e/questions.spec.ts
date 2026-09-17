import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {expect, test, type Locator, type Page} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {careerYears} from '../../src/app/[locale]/_components/format';
import {HERO_QUESTIONS, MATCH_QUESTION} from '../../src/app/[locale]/_components/hero-questions';
import {parseQaFile, type QaEntry} from '../../src/content/qa-parser';
import {display, LANGS, type Lang} from './fixture-cv';
import {heroLabel, sentinelle} from './hero-labels';

/**
 * Preuve navigateur des cinq questions du premier écran (CAP-2, story 5),
 * contre l'**artefact de production** : un clic restitue le corps écrit dans
 * `qa.<lang>.md`, sans qu'aucune requête ne parte ailleurs que vers le site,
 * et laisse dans `usage.db` un `exchange` de sorte `hero`, à coût nul.
 *
 * Rien n'est comparé à un texte écrit ici : les corps attendus sont **lus dans
 * la fixture** par le même analyseur que le serveur (`parseQaFile`), et les
 * libellés des puces viennent des catalogues, paramètre calculé compris
 * (`hero-labels.ts`). La base est relue en lecture seule, comme dans
 * `journal.spec.ts` : seulement ce qu'on vient d'écrire, jamais un total.
 */
const messages = {fr, en};
const USAGE_DB = resolve(__dirname, '../fixtures/data/usage.db');
const FIXTURES = resolve(__dirname, '../fixtures/content');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Les entrées de la fixture, par langue et identifiant — celles que la route sert. */
const corpus: Record<Lang, Record<string, QaEntry>> = Object.fromEntries(
  LANGS.map((lang) => {
    const {entries, errors} = parseQaFile(readFileSync(resolve(FIXTURES, `qa.${lang}.md`), 'utf8'), lang);
    expect(errors, `qa.${lang}.md doit être valide`).toEqual([]);
    return [lang, Object.fromEntries(entries.map((entry) => [entry.id, entry]))];
  })
) as Record<Lang, Record<string, QaEntry>>;

const VIEWPORTS = [
  {name: 'dans le tiroir (390 px)', viewport: {width: 390, height: 844}},
  {name: 'dans le premier écran (1440 px)', viewport: {width: 1440, height: 900}}
] as const;

type ExchangeRow = {
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
function lire<T>(sql: string, ...params: string[]): T | undefined {
  const db = new DatabaseSync(USAGE_DB, {readOnly: true});
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

const exchange = (id: string) =>
  lire<ExchangeRow>(
    `SELECT id, session_id, kind, status, question, answer, sources, citation_ok,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            cost_micro_usd, latency_ms, at
     FROM exchange WHERE id = ?`,
    id
  );
const sessionLang = (id: string) => lire<{lang: string}>('SELECT lang FROM session WHERE id = ?', id)?.lang;
const exchangesOf = (sessionId: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM exchange WHERE session_id = ?', sessionId)!.n;

/** L'identifiant de session tel que le navigateur le tient — même lecture que `proxy.ts`. */
function sessionDuContexte(cookies: {name: string; value: string}[]): string {
  const sessionId = cookies.find(({name}) => name === 'cv_session')?.value.split('.')[0];
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return sessionId!;
}

/**
 * Le panneau visible : sous `lg`, celui du tiroir, qu'on ouvre par la barre ;
 * au-dessus, celui du premier écran. `getByRole` ignore la copie masquée.
 */
async function ouvrirPanneau(page: Page, locale: Lang, width: number): Promise<Locator> {
  const barre = page.locator('summary');
  if (width < 1024) {
    await expect(barre).toBeVisible();
    await barre.click();
  } else {
    await expect(barre).toBeHidden();
  }
  return page.getByRole('region', {name: messages[locale].assistant.eyebrow});
}

/** Les requêtes qui partent ailleurs que vers le site — il ne doit y en avoir aucune. */
function surveillerLesSorties(page: Page, baseURL: string): string[] {
  const sorties: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL)) sorties.push(request.url());
  });
  return sorties;
}

for (const {name, viewport} of VIEWPORTS) {
  test.describe(name, () => {
    test.use({viewport});

    for (const locale of LANGS) {
      test(`/${locale} : chaque puce restitue le corps de la fixture et journalise un échange à coût nul`, async ({
        page,
        context
      }, testInfo) => {
        const sorties = surveillerLesSorties(page, testInfo.project.use.baseURL!);
        await page.goto(`/${locale}`);
        await page.waitForLoadState('networkidle');
        const sessionId = sessionDuContexte(await context.cookies());
        const panneau = await ouvrirPanneau(page, locale, viewport.width);
        const avant = exchangesOf(sessionId);

        for (const id of HERO_QUESTIONS) {
          const entree = corpus[locale][id]!;
          expect(entree.statut, `${id} doit être ordinaire dans la fixture`).toBe('normale');
          const puce = panneau.getByRole('button', {name: heroLabel(locale, id), exact: true});
          await expect(puce).toBeEnabled();

          const appel = page.waitForResponse((response) =>
            response.url().includes(`/api/questions/${id}?lang=${locale}`)
          );
          await puce.click();
          const response = await appel;
          expect(response.status()).toBe(200);
          expect(response.headers()['cache-control']).toContain('no-store');
          const corps = (await response.json()) as {
            id: string;
            question: string;
            answer: string;
            sources: string[];
            exchangeId: string | null;
          };
          // Le corps de l'entrée, tel qu'écrit, et sa clé de citation.
          expect(corps).toMatchObject({
            id,
            question: entree.question,
            answer: entree.corps,
            sources: [`qa:${id}`]
          });
          expect(corps.exchangeId).toMatch(ULID);

          // Rendu dans le panneau : la question du corpus en titre — et le focus
          // dessus —, le corps **rendu** (le Markdown de la fixture devient des
          // éléments, le mot-sentinelle est là), la mention, le retour. Les
          // puces ont laissé la place.
          const titre = panneau.getByRole('heading', {level: 3});
          await expect(titre).toHaveText(entree.question);
          await expect(titre).toBeFocused();
          await expect(panneau.getByText(sentinelle(locale, id))).toBeVisible();
          const corpsBrut = entree.corps!;
          const puces = corpsBrut.split('\n').filter((ligne) => /^- /.test(ligne)).length;
          const numeros = corpsBrut.split('\n').filter((ligne) => /^\d+\. /.test(ligne)).length;
          await expect(panneau.locator('ul li')).toHaveCount(puces);
          await expect(panneau.locator('ol li')).toHaveCount(numeros);
          await expect(panneau.locator('strong')).toHaveCount(corpsBrut.includes('**') ? 1 : 0);
          await expect(panneau.locator('em')).toHaveCount(/(^|[^*])\*[^*]+\*([^*]|$)/.test(corpsBrut) ? 1 : 0);
          // Aucun marqueur brut à l'écran : ni astérisque, ni tiret de liste.
          expect(await panneau.innerText()).not.toMatch(/\*\*|\n- /);
          await expect(panneau.getByText(messages[locale].assistant.answerSource)).toBeVisible();
          await expect(puce).toBeHidden();
          // L'autre copie du panneau — masquée à cette largeur — n'a pas bougé :
          // chaque copie porte son état, un clic dans le tiroir répond dans le tiroir.
          const autreCopie = viewport.width < 1024 ? 'assistant-titre' : 'assistant-titre-tiroir';
          await expect(page.locator(`section[aria-labelledby="${autreCopie}"] h3`)).toHaveCount(0);

          // Journalisé : `hero`, `done`, coût nul, aucun jeton, la source en JSON,
          // rattaché à la session du navigateur.
          const ligne = exchange(corps.exchangeId!);
          expect(ligne, 'lʼéchange doit être en base').toBeDefined();
          expect(ligne).toMatchObject({
            session_id: sessionId,
            kind: 'hero',
            status: 'done',
            question: entree.question,
            answer: entree.corps,
            citation_ok: 1,
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_creation_tokens: null,
            cost_micro_usd: 0
          });
          expect(JSON.parse(ligne!.sources!)).toEqual([`qa:${id}`]);
          expect(ligne!.latency_ms).toBeGreaterThanOrEqual(0);

          // Retour aux questions : la puce est de nouveau là, active, et le
          // focus lui revient.
          await panneau.getByRole('button', {name: messages[locale].assistant.back, exact: true}).click();
          await expect(puce).toBeVisible();
          await expect(puce).toBeEnabled();
          await expect(puce).toBeFocused();
        }

        expect(exchangesOf(sessionId) - avant).toBe(HERO_QUESTIONS.length);
        // La session parle la langue de la page (AD-5).
        expect(sessionLang(sessionId)).toBe(locale);
        // Aucune requête n'est partie ailleurs que vers le site : pas de modèle.
        expect(sorties).toEqual([]);
      });
    }

    test('pendant la requête, les puces se désactivent, lʼattente sʼaffiche, et un seul appel part', async ({
      page
    }) => {
      // La route est retenue tant que le test regarde l'état intermédiaire :
      // une porte que le test ouvre, pas un chronomètre.
      let appels = 0;
      let liberer: (() => void) | undefined;
      const retenue = new Promise<void>((resolve) => {
        liberer = resolve;
      });
      await page.route('**/api/questions/**', async (route) => {
        appels += 1;
        await retenue;
        await route.continue();
      });
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
      const puce = panneau.getByRole('button', {name: heroLabel('fr', 'lic-01'), exact: true});
      await expect(puce).toBeEnabled();

      await puce.click();
      await expect(panneau.getByRole('status')).toHaveText(messages.fr.assistant.loading);
      await expect(puce).toHaveAttribute('aria-busy', 'true');
      for (const id of HERO_QUESTIONS) {
        await expect(panneau.getByRole('button', {name: heroLabel('fr', id), exact: true})).toBeDisabled();
      }
      // Un second clic pendant l'attente ne part pas : la puce est désactivée.
      await puce.click({force: true});

      liberer!();
      await expect(panneau.getByRole('heading', {level: 3})).toHaveText(corpus.fr['lic-01']!.question);
      expect(appels).toBe(1);
    });

    test('chaque refus a son message, et le focus revient sur la puce', async ({page}) => {
      const cas: [number, string, string][] = [
        [400, '{"ok":false,"reason":"invalid_input"}', messages.fr.errors.invalid_input],
        [404, '{"ok":false,"reason":"content_unavailable"}', messages.fr.errors.content_unavailable],
        [404, '{"ok":false,"reason":"unknown"}', messages.fr.errors.unavailable],
        // Un 200 dont le corps n'est pas une réponse vaut un échec, pas un panneau vide.
        [200, '{"question":"","answer":""}', messages.fr.errors.unavailable],
        [200, '"pas un objet"', messages.fr.errors.unavailable]
      ];
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
      const puce = panneau.getByRole('button', {name: heroLabel('fr', 'ia-01'), exact: true});

      for (const [status, body, attendu] of cas) {
        await page.route('**/api/questions/**', (route) =>
          route.fulfill({status, contentType: 'application/json', body})
        );
        await puce.click();
        await expect(panneau.getByRole('alert')).toHaveText(attendu);
        await expect(puce).toBeEnabled();
        await expect(puce).toBeFocused();
        await page.unroute('**/api/questions/**');
      }
    });

    test('quand la route échoue, le message localisé sʼaffiche et les puces se réactivent', async ({
      page
    }) => {
      await page.route('**/api/questions/**', (route) =>
        route.fulfill({status: 503, contentType: 'text/plain', body: 'indisponible'})
      );
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
      const puce = panneau.getByRole('button', {name: heroLabel('fr', 'sit-02'), exact: true});

      await puce.click();

      await expect(panneau.getByRole('alert')).toHaveText(messages.fr.errors.unavailable);
      await expect(puce).toBeEnabled();
      await expect(panneau.getByRole('heading', {level: 3})).toHaveCount(0);
    });

    test('la sixième puce reste désactivée (story 7) ; le champ libre répond (story 6)', async ({page}) => {
      // Le test « inerte » de la story 3, inversé par la story 5 pour les puces,
      // par la story 6 pour le champ — et non supprimé : un assistant muet ne
      // doit plus passer la suite en silence. La sixième attend la story 7.
      await page.goto('/fr');
      const panneau = await ouvrirPanneau(page, 'fr', viewport.width);

      await expect(
        panneau.getByRole('button', {name: heroLabel('fr', MATCH_QUESTION), exact: true})
      ).toBeDisabled();
      await expect(panneau.getByRole('textbox', {name: messages.fr.assistant.questionLabel})).toBeEnabled();
      // Et la ligne d'état le dit, une fois hydraté.
      await expect(panneau.getByText(messages.fr.assistant.inactive)).toBeVisible();
      await expect(panneau.getByText(messages.fr.assistant.withoutScript)).toHaveCount(0);
    });
  });
}

test.describe('une route muette', () => {
  // Une fois, sur une seule largeur : le délai vaut huit secondes réelles.
  test.use({viewport: {width: 1440, height: 900}});

  test('finit par un message : le délai de huit secondes côté client', async ({page}) => {
    await page.route('**/api/questions/**', () => {});
    await page.goto('/fr');
    const panneau = await ouvrirPanneau(page, 'fr', 1440);
    const puce = panneau.getByRole('button', {name: heroLabel('fr', 'wd-02'), exact: true});

    await puce.click();
    await expect(panneau.getByRole('status')).toHaveText(messages.fr.assistant.loading);
    await expect(panneau.getByRole('alert')).toHaveText(messages.fr.errors.unavailable, {
      timeout: 11_000
    });
    await expect(puce).toBeEnabled();
  });
});

test.describe('sans JavaScript', () => {
  test.use({javaScriptEnabled: false});

  for (const {name, viewport} of VIEWPORTS) {
    test.describe(name, () => {
      test.use({viewport});

      test('les six puces et le champ libre restent désactivés : rien ne promet ce qui ne peut pas répondre', async ({
        page
      }) => {
        await page.goto('/fr');
        const panneau = await ouvrirPanneau(page, 'fr', viewport.width);
        for (const id of [...HERO_QUESTIONS, MATCH_QUESTION]) {
          const puce = panneau.getByRole('button', {name: heroLabel('fr', id), exact: true});
          await expect(puce).toBeVisible();
          await expect(puce).toBeDisabled();
        }
        await expect(panneau.getByRole('textbox', {name: messages.fr.assistant.questionLabel})).toBeDisabled();
        // La ligne d'état ne ment pas : c'est celle du visiteur sans JavaScript.
        await expect(panneau.getByText(messages.fr.assistant.withoutScript)).toBeVisible();
        await expect(panneau.getByText(messages.fr.assistant.inactive)).toHaveCount(0);
      });
    });
  }
});

test.describe('le libellé de wd-02', () => {
  test.use({viewport: {width: 1440, height: 900}});

  for (const locale of LANGS) {
    test(`/${locale} porte le nombre dʼannées calculé, jamais écrit`, async ({page}) => {
      const annees = careerYears(display[locale].experiences, new Date())!;
      expect(annees).toBeGreaterThan(0);
      const libelle = heroLabel(locale, 'wd-02');
      expect(libelle).toContain(String(annees));
      expect(libelle).not.toContain('{years}');

      await page.goto(`/${locale}`);
      const panneau = page.getByRole('region', {name: messages[locale].assistant.eyebrow});
      await expect(panneau.getByRole('button', {name: libelle, exact: true})).toBeVisible();
      // Et aucune autre puce ne porte un nombre : seul ce libellé est paramétré.
      const libelles = await panneau.getByRole('button').allInnerTexts();
      expect(libelles.filter((texte) => /\d/.test(texte))).toEqual([libelle]);
    });
  }
});

test.describe('le document servi', () => {
  for (const locale of LANGS) {
    test(`/${locale} ne porte aucun corps du corpus : la réponse nʼarrive que par la route`, async ({
      request
    }) => {
      // Les libellés des puces sont de l'interface ; le corps d'une entrée est
      // du contenu, et le composant client n'en reçoit jamais en propriété.
      // Le mot-sentinelle de chaque corps, sans caractère qu'un encodage HTML
      // ou JSON transformerait : s'il était passé au client, il serait là.
      const html = await (await request.get(`/${locale}`)).text();
      for (const id of HERO_QUESTIONS) {
        expect(corpus[locale][id]!.corps).toContain(sentinelle(locale, id));
        expect(html, `corps de ${id}`).not.toContain(sentinelle(locale, id));
      }
    });
  }

  test('la route refuse ce qui nʼest pas une des cinq questions, ou une langue inconnue', async ({
    request
  }) => {
    for (const chemin of [`/api/questions/${MATCH_QUESTION}?lang=fr`, '/api/questions/sal-01?lang=fr']) {
      const reponse = await request.get(chemin);
      expect(reponse.status(), chemin).toBe(404);
      expect(await reponse.json()).toEqual({ok: false, reason: 'unknown'});
    }
    for (const chemin of ['/api/questions/lic-01?lang=de', '/api/questions/lic-01']) {
      const reponse = await request.get(chemin);
      expect(reponse.status(), chemin).toBe(400);
      expect(await reponse.json()).toEqual({ok: false, reason: 'invalid_input'});
    }
  });

  test('sans cookies, la route répond le corps et nʼécrit rien', async ({playwright}, testInfo) => {
    const anonyme = await playwright.request.newContext({baseURL: testInfo.project.use.baseURL});
    const reponse = await anonyme.get('/api/questions/site-02?lang=en');

    expect(reponse.status()).toBe(200);
    expect(await reponse.json()).toEqual({
      id: 'site-02',
      question: corpus.en['site-02']!.question,
      answer: corpus.en['site-02']!.corps,
      sources: ['qa:site-02'],
      exchangeId: null
    });
    expect(reponse.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie')).toBe(false);
    await anonyme.dispose();
  });
});
