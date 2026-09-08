import {expect, test} from '@playwright/test';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

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
  await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.fr.shell.heading);
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
    // Le texte vient bien du catalogue de la langue, pas d'un repli.
    await expect(page.getByRole('heading', {level: 1})).toHaveText(messages[locale].shell.heading);
    await expect(page.getByText(messages[locale].shell.tagline)).toBeVisible();
    await expect(page).toHaveTitle(messages[locale].meta.title);
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
  await expect(page.getByRole('heading', {level: 1})).toHaveText(messages.en.shell.heading);
});

test('une page inconnue rend un document complet, pas un fragment', async ({page}) => {
  const response = await page.goto('/fr/chemin-inexistant');

  expect(response?.status()).toBe(404);
  // Le document 404 hérite bien de la racine `src/app/layout.tsx`.
  await expect(page.locator('html')).toHaveCount(1);
  await expect(page.locator('body')).toHaveCount(1);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
});

test('/admin échappe au routage de langue et nʼest pas servi sans ADMIN_DEV', async ({request}) => {
  const response = await request.get('/admin', {maxRedirects: 0});

  // Jamais de redirection vers /fr/admin : l'admin vit hors `[locale]` (AD-10).
  expect(response.headers().location).toBeUndefined();
  // `ADMIN_DEV=0` est imposé par la configuration Playwright, pas par le poste.
  expect(response.status()).toBe(404);
});
