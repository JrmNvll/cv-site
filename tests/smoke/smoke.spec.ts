import {expect, test, type APIRequestContext, type Page} from '@playwright/test';
import fr from '../../messages/fr.json';
import {HERO_QUESTIONS, YEARS_QUESTION} from '../../src/app/(site)/[locale]/_components/hero-questions';

/**
 * Test de fumée contre une URL **réelle** (story 11, CAP-10) — après un
 * déploiement, ou contre l'artefact local pour prouver le test lui-même.
 *
 * Le site visé sert son contenu réel : rien ici ne compare un texte, seulement
 * des **propriétés** — la matrice de la story, ligne par ligne : pages `200`
 * avec `lang` et `noindex`, la 404 en document complet, `robots.txt` qui
 * interdit tout, cookies de visite `Secure`, aucun `mailto:`, `tel:`, numéro
 * ni adresse électronique dans le HTML, feuilles de style, scripts et photo
 * servis par l'artefact seul (`postbuild`, `sharp`), une puce du premier écran
 * qui répond sans appel au modèle, la route des questions, et les deux routes
 * du modèle qui refusent un corps invalide en `400` (AD-16) — preuve à coût
 * nul qu'elles traversent le proxy. Et, **derrière Caddy seulement**
 * (`SMOKE_BEHIND_PROXY=1`) : `401` sur `/admin*` sous toutes ses graphies,
 * `X-Robots-Tag` sur toute réponse, HSTS et `nosniff`, la redirection vers
 * HTTPS, et `X-Client-IP-Seen: 1` — la preuve que Caddy pose bien l'adresse
 * (AD-15). Sans proxy, ces vérifications sont sautées avec leur raison ; le
 * lanceur (`scripts/smoke.mjs`) les compte, et les tient pour un échec en
 * mode proxy.
 *
 * Aucune de ces requêtes n'est journalisée : `recordVisit` ignore l'agent
 * utilisateur `cv-site-smoke/…` que pose `playwright.smoke.config.ts`
 * (décision du 2026-09-22) — le journal du site garde les visites, pas les
 * vérifications de son propriétaire.
 *
 * Le modèle n'est **jamais** appelé : la seule question posée est une puce du
 * premier écran, servie depuis le corpus à coût nul ; les routes du modèle ne
 * reçoivent qu'un corps invalide, refusé avant toute visite. Chaque requête
 * est une visite journalisée par le site visé — le test en fait peu, en un
 * seul worker, sous l'agent utilisateur `cv-site-smoke/<version>`.
 */
/** Vrai quand Caddy est devant le site visé : ses en-têtes et son `basic_auth` sont exigés. */
const BEHIND_PROXY = process.env.SMOKE_BEHIND_PROXY === '1';
const LANGS = ['fr', 'en'] as const;
/** Les six documents du site, par langue : le CV et les deux pages de prose. */
const DOCUMENTS = LANGS.flatMap((locale) => ['', '/comment', '/mentions'].map((page) => `/${locale}${page}`));
const ATTEND_LE_PROXY = 'attend le proxy : SMOKE_BEHIND_PROXY=1 (ou --behind-proxy) pour lʼexiger';

/**
 * La puce cliquée : la première des cinq, dont le libellé est un texte fixe du
 * catalogue — pas celle des années (`wd-02`), dont le libellé se calcule depuis
 * le contenu, qu'on ne connaît pas ici.
 */
const PUCE = 'lic-01';
const PUCE_LABEL: string = fr.assistant.questions[PUCE];

/**
 * Les formes d'une coordonnée qu'un `cv.yaml` peut porter, et rien de plus
 * large : un hachage de script, une date, une version ou du base64 ne doivent
 * pas y tomber.
 *  - international : `+41 79 123 45 67`, `+33 6 12 34 56 78`, `+41791234567` —
 *    pas précédé d'un caractère de base64 (`abc+123456789…` n'est pas un numéro) ;
 *  - national : `079 123 45 67`, `06 12 34 56 78` — séparateurs obligatoires ;
 *  - une adresse électronique en clair.
 * Séparateurs admis : espace, espace insécable (`\xa0`), point, tiret.
 */
const CONTACT_PATTERNS = [
  /(?<![A-Za-z0-9+/=])\+\d{1,3}(?:[ \xa0.-]?\d){8,12}(?!\d)/,
  /(?<!\d)0\d{1,2}(?:[ \xa0.-]\d{2,3}){3,4}(?!\d)/,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i
];

/** Ramène les entités d'espace insécable au caractère, pour que les motifs les voient. */
function normalise(html: string): string {
  return html.replace(/&nbsp;|&#160;|&#xa0;/gi, '\xa0');
}

function assertNoindex(html: string, url: string): void {
  expect(html, `${url} : balise robots`).toMatch(/<meta name="robots" content="noindex, nofollow"/);
}

function assertLang(html: string, locale: string, url: string): void {
  expect(html, `${url} : attribut lang`).toMatch(new RegExp(`<html[^>]*\\slang="${locale}"`));
}

/**
 * Les requêtes qui partent ailleurs que vers le site — il ne doit y en avoir
 * aucune. Seules les URL `http(s)` comptent : `data:` ou `blob:` n'ont pas
 * d'origine (`'null'`) et ne sortent pas du navigateur.
 */
function surveillerLesSorties(page: Page, baseURL: string): string[] {
  const sorties: string[] = [];
  const origine = new URL(baseURL).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origine) sorties.push(request.url());
  });
  return sorties;
}

async function document(request: APIRequestContext, url: string): Promise<{status: number; html: string; headers: Record<string, string>}> {
  const response = await request.get(url);
  return {status: response.status(), html: await response.text(), headers: response.headers()};
}

test('la racine sans langue mène à /fr', async ({page}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/fr$/);
});

for (const url of DOCUMENTS) {
  const locale = url.slice(1, 3);
  test(`${url} répond 200, en ${locale}, noindex`, async ({request}) => {
    const {status, html} = await document(request, url);
    expect(status).toBe(200);
    assertLang(html, locale, url);
    assertNoindex(html, url);
  });
}

test('une URL inconnue répond 404 : un document complet, dans sa langue, noindex', async ({request}) => {
  const {status, html} = await document(request, '/fr/chemin-inexistant');
  expect(status).toBe(404);
  assertLang(html, 'fr', '/fr/chemin-inexistant');
  assertNoindex(html, '/fr/chemin-inexistant');
  expect(html).toMatch(/<body[\s>]/);
});

test('robots.txt interdit tout', async ({request}) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  const body = (await response.text()).toLowerCase();
  expect(body).toContain('user-agent: *');
  expect(body).toContain('disallow: /');
});

test('la visite pose cv_visitor et cv_session — HttpOnly, Secure, SameSite=Lax — et rien dʼautre', async ({page, context}) => {
  await page.goto('/fr');
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name).sort()).toEqual(['cv_session', 'cv_visitor']);
  for (const cookie of cookies) {
    expect(cookie.httpOnly, `${cookie.name} HttpOnly`).toBe(true);
    expect(cookie.secure, `${cookie.name} Secure`).toBe(true);
    expect(cookie.sameSite, `${cookie.name} SameSite`).toBe('Lax');
    expect(cookie.path).toBe('/');
  }
});

test('les motifs de coordonnées reconnaissent bien un numéro et une adresse — sinon le test suivant ne prouve rien', () => {
  const detecte = (texte: string) => CONTACT_PATTERNS.some((pattern) => pattern.test(texte));
  for (const exemple of [
    '+41 79 123 45 67',
    '+41 00 000 00 07',
    '+33 6 12 34 56 78',
    '+41791234567',
    '079 123 45 67',
    '06 12 34 56 78',
    'jean.exemple@exemple.ch',
    'tel : +41\xa079\xa0123\xa045\xa067'
  ]) {
    expect(detecte(exemple), exemple).toBe(true);
  }
  for (const innocent of [
    '2026-09-18',
    '01.09.2026',
    '1440',
    '0.75',
    '01H9GV6XQ2K3',
    'chunks/3f0a92b1c4d5e6f7.js',
    '0123456789',
    'react@19.0.0',
    '@media (min-width: 1024px)',
    'abc+123456789',
    'AbC/+41791234567=='
  ]) {
    expect(detecte(innocent), innocent).toBe(false);
  }
  // Les entités d'espace insécable sont ramenées au caractère avant la recherche.
  expect(detecte(normalise('+41&nbsp;79&#160;123&#xa0;45 67'))).toBe(true);
});

for (const url of DOCUMENTS) {
  test(`${url} ne porte ni mailto:, ni tel:, ni numéro, ni adresse électronique`, async ({request}) => {
    const {status, html} = await document(request, url);
    expect(status).toBe(200);
    const texte = normalise(html);
    expect(texte.toLowerCase()).not.toContain('mailto:');
    expect(texte).not.toMatch(/["'`]tel:/i);
    for (const pattern of CONTACT_PATTERNS) {
      // Le fragment n'est pas cité : s'il existe, il est précisément ce qui ne doit pas sortir.
      expect(pattern.test(texte), `${url} : un motif de coordonnée (${pattern}) apparaît dans le document`).toBe(false);
    }
  });
}

test('la feuille de style et un script de la page sont servis par lʼartefact (postbuild)', async ({request}) => {
  const {html} = await document(request, '/fr');
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]!);
  const scripts = [...html.matchAll(/<script[^>]+src="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1]!);
  expect(styles.length, 'au moins une feuille de style').toBeGreaterThanOrEqual(1);
  expect(scripts.length, 'au moins un script').toBeGreaterThanOrEqual(1);

  const style = await request.get(styles[0]!);
  expect(style.status(), styles[0]).toBe(200);
  expect(style.headers()['content-type']).toContain('text/css');
  const script = await request.get(scripts[0]!);
  expect(script.status(), scripts[0]).toBe(200);
  expect(script.headers()['content-type']).toMatch(/javascript/);
});

test('la photo est servie redimensionnée (sharp sur lʼartefact)', async ({request}) => {
  const {html} = await document(request, '/fr');
  test.skip(!html.includes('/api/photo'), 'le contenu ne déclare pas de photo');
  const photo = await request.get('/api/photo?s=2');
  expect(photo.status()).toBe(200);
  expect(photo.headers()['content-type']).toMatch(/^image\//);
  expect(photo.headers()['cache-control']).toContain('private');
  expect((await photo.body()).length).toBeGreaterThan(0);
});

test('une puce du premier écran répond, sans appel au modèle ni requête sortante', async ({page}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const sorties = surveillerLesSorties(page, baseURL);
  await page.goto('/fr');
  await page.waitForLoadState('networkidle');

  const panneau = page.getByRole('region', {name: fr.assistant.eyebrow});
  const puce = panneau.getByRole('button', {name: PUCE_LABEL, exact: true});
  await expect(puce).toBeEnabled();

  const appel = page.waitForResponse((response) => response.url().includes(`/api/questions/${PUCE}?lang=fr`));
  await puce.click();
  const response = await appel;
  expect(response.status()).toBe(200);
  const corps = (await response.json()) as {id: string; answer: string; sources: string[]};
  expect(corps.id).toBe(PUCE);
  expect(typeof corps.answer).toBe('string');
  expect(corps.answer.length).toBeGreaterThan(0);
  expect(corps.sources).toEqual([`qa:${PUCE}`]);

  // La réponse est rendue : un titre de niveau 3 (la question), le retour.
  await expect(panneau.getByRole('heading', {level: 3})).toBeVisible();
  await expect(panneau.getByRole('button', {name: fr.assistant.back, exact: true})).toBeVisible();
  expect(sorties).toEqual([]);
});

test(`/api/questions/${PUCE}?lang=fr répond 200 avec la réponse du corpus`, async ({request}) => {
  expect(HERO_QUESTIONS).toContain(PUCE);
  expect(PUCE).not.toBe(YEARS_QUESTION);
  const response = await request.get(`/api/questions/${PUCE}?lang=fr`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const corps = (await response.json()) as {id: string; question: string; answer: string; sources: string[]};
  expect(corps.id).toBe(PUCE);
  expect(corps.question.length).toBeGreaterThan(0);
  expect(corps.answer.length).toBeGreaterThan(0);
  expect(corps.sources).toEqual([`qa:${PUCE}`]);
});

test('les routes du modèle refusent un corps invalide en 400 invalid_input — sans rien appeler (AD-16)', async ({request}) => {
  // `invalid_input` est contrôlé avant la visite (`stream-route.ts`) : aucun
  // cookie nécessaire, aucun échange réservé, aucun appel. Un `{}` n'a ni
  // question ni langue.
  for (const chemin of ['/api/chat', '/api/match']) {
    const response = await request.post(chemin, {data: {}, maxRedirects: 0});
    expect(response.status(), chemin).toBe(400);
    expect(await response.json(), chemin).toEqual({ok: false, reason: 'invalid_input'});
  }
});

test.describe('derrière Caddy — sautés sans --behind-proxy', () => {
  /** Un identifiant bien formé, qui n'existe pas. */
  const ULID_INCONNU = '01H9GV6XQ2K3M4N5P6Q7R8S9T0';

  test('/admin* sans identifiants répond 401, WWW-Authenticate: Basic, sans contenu ni cookie', async ({request}) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    const chemins = ['/admin', '/admin/', '/admin/questions', `/admin/sessions/${ULID_INCONNU}`];
    for (const chemin of chemins) {
      const response = await request.get(chemin, {maxRedirects: 0});
      expect(response.status(), chemin).toBe(401);
      expect(response.headers()['www-authenticate'], chemin).toMatch(/^Basic\b/i);
      expect((await response.body()).length, `${chemin} : aucun contenu`).toBe(0);
      expect(response.headersArray().some(({name}) => name.toLowerCase() === 'set-cookie'), `${chemin} : aucun cookie`).toBe(false);
    }
    // Les mutations aussi : le matcher couvre tout `/admin*`.
    const mutation = await request.post(`/admin/api/visiteurs/${ULID_INCONNU}`, {
      form: {name: 'x', from: '/admin'},
      maxRedirects: 0
    });
    expect(mutation.status()).toBe(401);
    // HSTS et `-Server` ne sont **pas** exigés sur ce 401 : le bloc `header` du
    // snippet `commun` est différé (il retire `Server`), et les opérations
    // différées ne s'appliquent probablement pas à la réponse d'erreur de
    // `basic_auth`. À observer sur l'URL réelle : `curl -I https://…/admin`.
  });

  test('aucune graphie de /admin ne passe : //admin, /%61dmin, /admin%2Fquestions', async ({request}, testInfo) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    // Caddy normalise le chemin avant le matcher `/admin*` ; ce qui n'y tombe
    // pas doit être une 404 ou une redirection, jamais l'admin en 200. En URL
    // absolue : `//admin` relatif à la base serait lu comme un hôte « admin ».
    // (`/./admin` est absent : tout client URL le ramène à `/admin` avant l'envoi.)
    const origine = new URL(testInfo.project.use.baseURL!).origin;
    for (const chemin of ['//admin', '/%61dmin', '/admin%2Fquestions', '/Admin']) {
      const response = await request.get(`${origine}${chemin}`, {maxRedirects: 0});
      expect(response.status(), `${chemin} (${response.status()})`).not.toBe(200);
      const html = await response.text();
      expect(html, `${chemin} : rien de lʼadmin`).not.toMatch(/<html lang="fr"[^>]*>[\s\S]*Dépense du mois/);
    }
  });

  test('X-Robots-Tag: noindex, nofollow sur toute réponse', async ({request}) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    // `/admin` compris : `header X-Robots-Tag` est une opération immédiate (pas
    // de suppression dans cette directive), posée avant que `basic_auth` ne
    // réponde 401 — à confirmer sur l'URL réelle.
    const chemins = ['/', '/fr', '/en', '/fr/comment', '/robots.txt', `/api/questions/${PUCE}?lang=fr`, '/fr/chemin-inexistant', '/admin'];
    for (const chemin of chemins) {
      const response = await request.get(chemin, {maxRedirects: 0});
      expect(response.headers()['x-robots-tag'], `${chemin} (${response.status()})`).toBe('noindex, nofollow');
    }
  });

  test('HSTS avec includeSubDomains, nosniff, Referrer-Policy — et pas dʼen-tête Server (snippet commun)', async ({request}) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    for (const chemin of ['/fr', '/robots.txt']) {
      const headers = (await request.get(chemin)).headers();
      expect(headers['strict-transport-security'], chemin).toMatch(/max-age=31536000/);
      expect(headers['strict-transport-security'], chemin).toMatch(/includeSubDomains/i);
      expect(headers['x-content-type-options'], chemin).toBe('nosniff');
      expect(headers['referrer-policy'], chemin).toBe('same-origin');
      expect(headers['server'], chemin).toBeUndefined();
    }
  });

  test('en HTTP clair, Caddy redirige vers HTTPS', async ({request}, testInfo) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    const cible = new URL(testInfo.project.use.baseURL!);
    // Sans HTTPS (un proxy local), il n'y a rien à rediriger : rien à prouver ici.
    if (cible.protocol !== 'https:') return;
    const response = await request.get(`http://${cible.host}/`, {maxRedirects: 0});
    expect([301, 308]).toContain(response.status());
    expect(response.headers()['location']).toMatch(new RegExp(`^https://${cible.host.replace(/\./g, '\\.')}/`));
  });

  test('X-Client-IP-Seen: 1 — Caddy pose lʼadresse du client, lʼapplication la voit (AD-15)', async ({request}) => {
    test.skip(!BEHIND_PROXY, ATTEND_LE_PROXY);
    // Le proxy applicatif répond `1` quand la requête porte un `X-Client-IP`
    // valide, `0` sinon — jamais la valeur. Sans cet en-tête, le journal
    // n'aurait que des adresses `unknown`, et rien d'autre ne le dirait.
    const response = await request.get('/fr');
    expect(response.headers()['x-client-ip-seen']).toBe('1');
  });
});
