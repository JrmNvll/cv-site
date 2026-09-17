import {expect, test} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import {display} from './fixture-cv';

/**
 * Preuve navigateur du socle — les « vérifications manuelles » de la story,
 * rendues rejouables. Les textes attendus viennent des catalogues : une clé
 * manquante se verrait ici, pas seulement en unitaire.
 */
const messages = {fr, en};

// Le premier caractère d'un ULID est borné à [0-7] (horodatage sur 48 bits).
const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';

test('la racine sans langue redirige vers /fr', async ({page}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByRole('heading', {level: 1})).toHaveText(display.fr.identite.titre);
});

for (const locale of ['fr', 'en'] as const) {
  test(`/${locale} répond, porte la bonne langue, le bon texte et la balise noindex`, async ({
    page
  }) => {
    const response = await page.goto(`/${locale}`);

    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    // AD-11 : l'application répète le noindex posé par Caddy.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow'
    );
    // Le titre de la page vient du catalogue de la langue, le `h1` de la
    // projection : ni l'un ni l'autre ne doit retomber sur l'autre langue.
    await expect(page).toHaveTitle(messages[locale].meta.title);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(display[locale].identite.titre);
  });
}

test('robots.txt interdit tout', async ({request}) => {
  const response = await request.get('/robots.txt');

  expect(response.status()).toBe(200);
  const body = (await response.text()).toLowerCase();
  expect(body).toContain('user-agent: *');
  expect(body).toContain('disallow: /');
});

test('la visite pose cv_visitor et cv_session en HttpOnly, Secure, SameSite=Lax', async ({
  page,
  context
}) => {
  await page.goto('/fr');
  const cookies = await context.cookies();

  const visitor = cookies.find((cookie) => cookie.name === 'cv_visitor');
  const session = cookies.find((cookie) => cookie.name === 'cv_session');

  expect(visitor, 'cv_visitor doit être posé').toBeDefined();
  expect(session, 'cv_session doit être posé').toBeDefined();

  for (const cookie of [visitor!, session!]) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
  }

  expect(visitor!.value).toMatch(new RegExp(`^${ULID}$`));
  expect(session!.value).toMatch(new RegExp(`^${ULID}\\.\\d+$`));
});

test('une réponse porteuse de cookie nʼest jamais mise en cache partagé', async ({request}) => {
  const response = await request.get('/fr');

  expect(response.headers()['set-cookie']).toBeTruthy();
  const cacheControl = response.headers()['cache-control'] ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
});

test('le visiteur est reconnu à la visite suivante', async ({page, context}) => {
  await page.goto('/fr');
  const first = (await context.cookies()).find((cookie) => cookie.name === 'cv_visitor')!.value;

  await page.goto('/en');
  const second = (await context.cookies()).find((cookie) => cookie.name === 'cv_visitor')!.value;

  expect(second).toBe(first);
});

test('le changement de langue mène de /fr à /en', async ({page}) => {
  await page.goto('/fr');
  await page.getByRole('link', {name: messages.en.languages.en}).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('heading', {level: 1})).toHaveText(display.en.identite.titre);
});

test('une page inconnue rend un document complet, pas un fragment', async ({page}) => {
  const response = await page.goto('/fr/chemin-inexistant');

  expect(response?.status()).toBe(404);
  // Le document 404 hérite bien de la racine du site, `src/app/(site)/layout.tsx`.
  await expect(page.locator('html')).toHaveCount(1);
  await expect(page.locator('body')).toHaveCount(1);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
});

test('/admin échappe au routage de langue et est servi sur lʼartefact de production, en français, noindex', async ({
  request
}) => {
  const response = await request.get('/admin', {maxRedirects: 0});

  // Jamais de redirection vers /fr/admin : l'admin vit hors `[locale]` (AD-10).
  expect(response.headers().location).toBeUndefined();
  // `ADMIN_DEV=0` est imposé par la configuration Playwright : en production,
  // c'est Caddy qui protège, pas la variable — l'admin est servi (AD-10). Le
  // « non servi sans ADMIN_DEV » en développement reste prouvé en unitaire
  // (`tests/unit/proxy.test.ts`).
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<html lang="fr"');
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  // Et aucun cookie de visite : l'admin ne se journalise pas.
  expect(response.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie')).toBe(false);
});
