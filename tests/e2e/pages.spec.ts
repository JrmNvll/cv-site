import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {expect, test, type APIResponse, type Page} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {MATCH_QUESTION} from '../../src/app/(site)/[locale]/_components/hero-questions';
import {display, rawCv, LANGS, type Lang} from './fixture-cv';
import {heroLabel} from './hero-labels';

/**
 * Preuve navigateur des deux pages de prose et du pied de page (story 9,
 * CAP-9), contre l'**artefact de production** : `/fr/comment`, `/en/comment`,
 * `/fr/mentions`, `/en/mentions` — chaque ligne de la matrice de la story.
 *
 * Les attentes viennent des mêmes sources que la page : les rubriques sont
 * **lues dans les fichiers Markdown** que le serveur inline, les libellés
 * (`footer.*`, `pages.*`) dans les catalogues de `messages/`, le nom de la
 * barre dans la projection de la fixture. Deux libellés de liens du corps
 * (« mentions légales », « page CV ») sont les seuls textes écrits ici : ils
 * sont ceux des fichiers Markdown, et `prose-pages.test.ts` fixe ces fichiers.
 * La base est relue en lecture seule, comme dans `journal.spec.ts` :
 * seulement ce qu'on vient d'écrire, jamais un total.
 */
const messages = {fr, en};
const PAGES = ['comment', 'mentions'] as const;
type Prose = (typeof PAGES)[number];
const USAGE_DB = resolve(__dirname, '../fixtures/data/usage.db');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const VIEWPORT = {width: 1280, height: 900};

/**
 * Les rubriques (`## …`) du fichier Markdown d'une page, dans l'ordre — ce que
 * la page doit rendre en `h2`, en texte : les dièses de fermeture retirés, le
 * balisage en ligne (gras, italique, lien) réduit à son texte, comme le rendu.
 */
function rubriques(page: Prose, lang: Lang): string[] {
  const texte = readFileSync(
    resolve(__dirname, `../../src/app/(site)/[locale]/${page}/${page}.${lang}.md`),
    'utf8'
  );
  return [...texte.matchAll(/^ {0,3}## +(.+?)(?: +#+)? *$/gm)].map((match) =>
    match[1]!
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1$2')
  );
}

/**
 * Une signature par cas et par tentative : ce que la base retient comme
 * `user_agent`. Avec `testInfo.retry`, une reprise en CI ne retrouve pas les
 * sessions du premier passage.
 */
function signature(testInfo: {testId: string; retry: number}): string {
  return `pages-spec/${testInfo.testId}/${testInfo.retry}`;
}

type SessionRow = {id: string; lang: string; started_at: string; last_seen_at: string};

/** Une connexion en lecture seule, le temps d'une requête : toujours l'état commis. */
function lire<T>(sql: string, ...params: string[]): T | undefined {
  const db = new DatabaseSync(USAGE_DB, {readOnly: true});
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

const session = (id: string) =>
  lire<SessionRow>('SELECT id, lang, started_at, last_seen_at FROM session WHERE id = ?', id);
const sessionsSignees = (userAgent: string) =>
  lire<{n: number}>('SELECT count(*) AS n FROM session WHERE user_agent = ?', userAgent)!.n;

/** L'identifiant de session des `Set-Cookie` d'une réponse — ce que le navigateur reçoit. */
function sessionRecue(response: APIResponse): string {
  const cookie = response
    .headersArray()
    .filter(({name}) => name.toLowerCase() === 'set-cookie')
    .map(({value}) => value)
    .find((value) => value.startsWith('cv_session='));
  const sessionId = cookie?.split(';')[0]!.slice('cv_session='.length).split('.')[0];
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return sessionId!;
}

/** L'identifiant de session tel que le navigateur le tient — même lecture que `proxy.ts`. */
function sessionDuContexte(cookies: {name: string; value: string}[]): string {
  const sessionId = cookies.find(({name}) => name === 'cv_session')?.value.split('.')[0];
  expect(sessionId, 'cv_session doit être posé').toMatch(ULID);
  return sessionId!;
}

/** Le document déborde-t-il latéralement ? */
async function debordeHorizontalement(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const {documentElement} = document;
    return documentElement.scrollWidth > documentElement.clientWidth + 1;
  });
}

/** La coquille commune : barre avec le nom et la langue, pied de page avec ses deux liens. */
async function coquilleCommune(page: Page, locale: Lang): Promise<void> {
  const cv = display[locale];
  const barre = page.locator('header');
  const nom = barre.getByText(`${cv.identite.prenom} ${cv.identite.nom}`, {exact: true});
  await expect(nom).toBeVisible();
  await expect(barre.getByRole('navigation', {name: messages[locale].languages.label})).toBeVisible();
  // Hors de la page principale, le nom y ramène — sans se voir : un lien, même
  // police et même couleur que le titre du premier écran, aucun soulignement
  // (décision du 2026-09-22). Sur la page principale, un texte : pas de lien vers soi.
  const lien = barre.getByRole('link', {name: `${cv.identite.prenom} ${cv.identite.nom}`, exact: true});
  if (new URL(page.url()).pathname === `/${locale}`) {
    await expect(lien).toHaveCount(0);
  } else {
    await expect(lien).toHaveAttribute('href', `/${locale}`);
    const style = await lien.evaluate((el) => {
      const s = getComputedStyle(el);
      return {decoration: s.textDecorationLine, family: s.fontFamily, size: s.fontSize, color: s.color};
    });
    expect(style.decoration).toBe('none');
    await lien.hover();
    expect(await lien.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
    const titre = page.getByRole('heading', {level: 1});
    const reference = await titre.evaluate((el) => {
      const s = getComputedStyle(el);
      return {family: s.fontFamily, color: s.color};
    });
    expect(style.family).toBe(reference.family);
    expect(style.color).toBe(reference.color);
    await lien.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await page.goBack();
  }

  const pied = page.locator('footer').getByRole('navigation', {name: messages[locale].footer.label});
  await expect(pied).toBeVisible();
  await expect(pied.getByRole('link', {name: messages[locale].footer.comment})).toHaveAttribute(
    'href',
    `/${locale}/comment`
  );
  await expect(pied.getByRole('link', {name: messages[locale].footer.mentions})).toHaveAttribute(
    'href',
    `/${locale}/mentions`
  );
  await expect(pied.getByRole('link')).toHaveCount(2);
}

for (const locale of LANGS) {
  for (const prose of PAGES) {
    test(`/${locale}/${prose} : 200, lang, noindex, titre, h1, rubriques en h2, liens sûrs, barre et pied de page`, async ({
      page
    }) => {
      const response = await page.goto(`/${locale}/${prose}`);
      expect(response?.status()).toBe(200);

      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      const titre = messages[locale].pages[prose].title;
      await expect(page).toHaveTitle(`${titre} — ${messages[locale].meta.title}`);
      await expect(page.getByRole('heading', {level: 1})).toHaveText(titre);

      // Les rubriques du fichier Markdown, chacune un `h2`, dans l'ordre — et rien d'autre en `h2`.
      const attendues = rubriques(prose, locale);
      expect(attendues.length).toBeGreaterThanOrEqual(6);
      await expect(page.locator('main h2')).toHaveText(attendues);

      // Chaque lien du corps porte `rel` et une adresse sûre ; vers l'extérieur,
      // un nouvel onglet (`target="_blank"`) ; un chemin du site, jamais.
      const liens = page.locator('main a');
      expect(await liens.count()).toBeGreaterThan(0);
      for (const lien of await liens.all()) {
        await expect(lien).toHaveAttribute('rel', 'nofollow noopener noreferrer');
        const href = await lien.getAttribute('href');
        expect(href).toMatch(/^(https:\/\/|\/(?!\/))/);
        expect(await lien.getAttribute('target'), href ?? '').toBe(href!.startsWith('https://') ? '_blank' : null);
      }

      await coquilleCommune(page, locale);
      expect(await debordeHorizontalement(page)).toBe(false);
    });
  }

  test(`/${locale}/comment renvoie aux mentions dans le texte ; /${locale}/mentions renvoie à « Comment » et au contact du CV`, async ({
    page
  }) => {
    await page.goto(`/${locale}/comment`);
    await expect(
      page.locator('main').getByRole('link', {name: locale === 'fr' ? 'mentions légales' : 'legal notice'})
    ).toHaveAttribute('href', `/${locale}/mentions`);

    await page.goto(`/${locale}/mentions`);
    const corps = page.locator('main');
    await expect(corps.getByRole('link', {name: messages[locale].pages.comment.title})).toHaveAttribute(
      'href',
      `/${locale}/comment`
    );
    await expect(corps.getByRole('link', {name: locale === 'fr' ? 'page CV' : 'CV page'})).toHaveAttribute(
      'href',
      `/${locale}#contact`
    );
    // Les faits que la page doit déclarer, dans son texte visible.
    for (const attendu of ['cv_visitor', 'cv_session', 'Anthropic', 'noindex', 'robots.txt', 'LinkedIn', 'GitHub']) {
      await expect(corps.getByText(attendu, {exact: false}).first()).toBeVisible();
    }
  });

  test(`/${locale} porte le pied de page, sous le CV — et le panneau de lʼassistant ne porte aucun lien vers les mentions`, async ({
    page
  }) => {
    await page.goto(`/${locale}`);
    await coquilleCommune(page, locale);

    // Retiré du panneau le 2026-09-22 (décision de Jérémie) : ni sous le champ
    // libre, ni sous la zone de l'annonce. Il reste au pied de chaque page,
    // vérifié par `coquilleCommune`.
    const panneau = page.getByRole('region', {name: messages[locale].assistant.eyebrow});
    await expect(panneau.getByRole('link', {name: messages[locale].footer.mentions})).toHaveCount(0);
    await panneau.getByRole('button', {name: heroLabel(locale, MATCH_QUESTION), exact: true}).click();
    const zone = panneau.getByRole('textbox', {name: messages[locale].assistant.matchLabel, exact: true});
    await expect(zone).toBeVisible();
    await expect(panneau.getByRole('link', {name: messages[locale].footer.mentions})).toHaveCount(0);
    // Après la dernière section, dans l'ordre du document.
    const positions = await page.evaluate(() => {
      const rang = (element: Element | null) =>
        element === null ? -1 : [...document.querySelectorAll('*')].indexOf(element);
      return {
        references: rang(document.querySelector('section[aria-labelledby="references"]')),
        pied: rang(document.querySelector('footer'))
      };
    });
    expect(positions.references).toBeGreaterThanOrEqual(0);
    expect(positions.pied).toBeGreaterThan(positions.references);
  });
}

test.describe('le courriel sur les mentions', () => {
  test('est un bouton, absent du HTML servi, révélé au clic — le même que la section Contact', async ({
    page,
    request
  }) => {
    const attendu = (rawCv.contact as {email: string}).email;
    // Le document brut ne porte pas l'adresse, ni sous forme échappée.
    const brut = await (await request.get('/fr/mentions')).text();
    expect(brut).not.toContain(attendu);
    expect(brut).not.toContain('mailto:');

    await page.goto('/fr/mentions');
    expect(await page.content()).not.toContain(attendu);
    const bouton = page.getByRole('button', {name: messages.fr.email.reveal});
    await expect(bouton).toBeVisible();
    // Sous la dernière rubrique, « Contact » : après son titre dans le document.
    const positions = await page.evaluate((libelle) => {
      const rang = (element: Element | null) =>
        element === null ? -1 : [...document.querySelectorAll('*')].indexOf(element);
      const titres = [...document.querySelectorAll('main h2')];
      const bouton = [...document.querySelectorAll('main button')].find((el) => el.textContent === libelle);
      return {dernierTitre: rang(titres.at(-1) ?? null), bouton: rang(bouton ?? null)};
    }, messages.fr.email.reveal);
    expect(positions.bouton).toBeGreaterThan(positions.dernierTitre);

    await bouton.click();
    const lien = page.getByRole('link', {name: attendu});
    await expect(lien).toHaveAttribute('href', `mailto:${attendu}`);
    await expect(lien).toBeFocused();
  });
});

test.describe('le sélecteur de langue depuis une page secondaire (report de la story 3, clos)', () => {
  for (const prose of PAGES) {
    test(`sur /fr/${prose}, le lien EN vise /en/${prose}, et y mène ; et retour`, async ({page}) => {
      await page.goto(`/fr/${prose}`);
      const versEn = page.getByRole('link', {name: messages.en.languages.en});
      await expect(versEn).toHaveAttribute('href', `/en/${prose}`);
      await expect(page.getByRole('link', {name: messages.fr.languages.fr})).toHaveAttribute('href', `/fr/${prose}`);

      // Une ancre ordinaire (story 9, report de la story 4 clos) : le
      // navigateur demande un **document** — la racine du site est rejouée,
      // `<html lang>` suit la langue, la visite est journalisée.
      const document = page.waitForResponse(
        (response) => response.url().endsWith(`/en/${prose}`) && response.request().resourceType() === 'document'
      );
      await versEn.click();
      expect((await document).status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`/en/${prose}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.en.pages[prose].title);
      await expect(page.locator('main h2')).toHaveText(rubriques(prose, 'en'));

      const versFr = page.getByRole('link', {name: messages.fr.languages.fr});
      await expect(versFr).toHaveAttribute('href', `/fr/${prose}`);
      await versFr.click();
      await expect(page).toHaveURL(new RegExp(`/fr/${prose}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.fr.pages[prose].title);
      await expect(page.locator('main h2')).toHaveText(rubriques(prose, 'fr'));
    });
  }

  test('la bascule prolonge la session : une navigation complète est une visite journalisée (AD-14)', async ({
    page,
    context
  }) => {
    await page.goto('/fr/comment');
    await page.waitForLoadState('networkidle');
    const sessionId = sessionDuContexte(await context.cookies());
    const avant = session(sessionId)!;

    await page.getByRole('link', {name: messages.en.languages.en}).click();
    await expect(page).toHaveURL(/\/en\/comment$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Même session, prolongée — pas une nouvelle.
    expect(sessionDuContexte(await context.cookies())).toBe(sessionId);
    const apres = session(sessionId)!;
    expect(apres.started_at).toBe(avant.started_at);
    expect(apres.last_seen_at > avant.last_seen_at).toBe(true);
  });

  test.describe('sans JavaScript', () => {
    test.use({javaScriptEnabled: false, viewport: VIEWPORT});

    test('le lien EN de /fr/comment fonctionne toujours : document anglais, lang="en"', async ({page}) => {
      await page.goto('/fr/comment');
      await page.getByRole('link', {name: messages.en.languages.en}).click();
      await expect(page).toHaveURL(/\/en\/comment$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.en.pages.comment.title);
      await expect(page.locator('main h2')).toHaveText(rubriques('comment', 'en'));
    });
  });
});

test.describe('la visite est journalisée (AD-14)', () => {
  test('GET /en/mentions crée une session en anglais ; /fr/comment, en français', async ({playwright}, testInfo) => {
    const userAgent = signature(testInfo);
    // Un contexte neuf par visite : aucun cookie, comme un premier visiteur.
    for (const [chemin, lang] of [
      ['/en/mentions', 'en'],
      ['/fr/comment', 'fr']
    ] as const) {
      const visiteur = await playwright.request.newContext({baseURL: testInfo.project.use.baseURL});
      const response = await visiteur.get(chemin, {headers: {'user-agent': userAgent}});
      expect(response.status(), chemin).toBe(200);
      await response.text();
      expect(session(sessionRecue(response))!.lang, chemin).toBe(lang);
      await visiteur.dispose();
    }
    expect(sessionsSignees(userAgent)).toBe(2);
  });

  test('depuis /fr, le lien du pied de page mène à /fr/mentions par une navigation complète, qui prolonge la session', async ({
    page,
    context
  }) => {
    await page.goto('/fr');
    await page.waitForLoadState('networkidle');
    const sessionId = sessionDuContexte(await context.cookies());
    const avant = session(sessionId)!;

    // Une ancre ordinaire : le navigateur demande un **document**, pas une
    // charge utile RSC — c'est ce qui rejoue la racine du site et le journal.
    const document = page.waitForResponse(
      (response) => response.url().endsWith('/fr/mentions') && response.request().resourceType() === 'document'
    );
    await page.locator('footer').getByRole('link', {name: messages.fr.footer.mentions}).click();
    const response = await document;
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/fr\/mentions$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.fr.pages.mentions.title);
    await expect(page.locator('main h2')).toHaveText(rubriques('mentions', 'fr'));

    // Même session, prolongée — pas une nouvelle.
    expect(sessionDuContexte(await context.cookies())).toBe(sessionId);
    const apres = session(sessionId)!;
    expect(apres.started_at).toBe(avant.started_at);
    expect(apres.last_seen_at > avant.last_seen_at).toBe(true);
  });
});

test('un chemin inconnu sous une page reste la 404 du site, document complet', async ({request}) => {
  for (const chemin of ['/fr/comment/x', '/fr/mentions/x', '/en/comment/autre', '/fr/autre']) {
    const response = await request.get(chemin);
    const corps = await response.text();
    expect(response.status(), chemin).toBe(404);
    const lang = chemin.startsWith('/en') ? 'en' : 'fr';
    expect(corps, chemin).toContain(`<html lang="${lang}"`);
    expect(corps, chemin).toMatch(new RegExp(`<h1[^>]*>${messages[lang].notFound.heading}</h1>`));
    expect(corps, chemin).not.toContain('__next_error__');
  }
});

test.describe('sans JavaScript', () => {
  test.use({javaScriptEnabled: false, viewport: VIEWPORT});

  test('les deux pages se lisent en entier, le pied de page fonctionne, le bouton du courriel est absent', async ({
    page
  }) => {
    await page.goto('/fr/mentions');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.fr.pages.mentions.title);
    for (const rubrique of rubriques('mentions', 'fr')) {
      await expect(page.getByRole('heading', {level: 2, name: rubrique, exact: true})).toBeVisible();
    }
    await expect(page.getByRole('button', {name: messages.fr.email.reveal})).toHaveCount(0);
    expect(await page.content()).not.toContain((rawCv.contact as {email: string}).email);
    // LinkedIn et GitHub restent joignables : le texte le dit, et renvoie à la page CV.
    await expect(page.locator('main').getByRole('link', {name: 'page CV'})).toHaveAttribute('href', '/fr#contact');

    await page.locator('footer').getByRole('link', {name: messages.fr.footer.comment}).click();
    await expect(page).toHaveURL(/\/fr\/comment$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.fr.pages.comment.title);
    for (const rubrique of rubriques('comment', 'fr')) {
      await expect(page.getByRole('heading', {level: 2, name: rubrique, exact: true})).toBeVisible();
    }
    await coquilleCommune(page, 'fr');
  });
});

test.describe('sur téléphone', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('les deux pages ne débordent pas, et sur le CV le pied de page reste au-dessus de la barre de lʼassistant', async ({
    page
  }) => {
    for (const prose of PAGES) {
      await page.goto(`/fr/${prose}`);
      expect(await debordeHorizontalement(page), prose).toBe(false);
      await expect(page.locator('footer')).toBeVisible();
    }

    await page.goto('/fr');
    const pied = page.locator('footer');
    await pied.scrollIntoViewIfNeeded();
    const boite = await pied.boundingBox();
    const barre = await page.locator('summary').boundingBox();
    expect(boite!.y + boite!.height).toBeLessThanOrEqual(barre!.y + 1);
  });
});
