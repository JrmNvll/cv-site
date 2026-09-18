/**
 * `npm run test:smoke -- --base-url <url> [--behind-proxy]` — le test de fumée
 * contre une URL **réelle** (story 11, CAP-10) : celle du VPS après un
 * déploiement, ou celle d'un artefact local (`http://127.0.0.1:3000`) pour
 * prouver le test lui-même.
 *
 * Ce script lance Playwright sur `playwright.smoke.config.ts` avec l'URL en
 * environnement (`SMOKE_BASE_URL`) : la ligne de commande de Playwright n'a
 * pas d'option d'URL, et une configuration sans `webServer` n'a rien à
 * démarrer — le site est déjà en ligne, ou il ne l'est pas. Sans URL, refus
 * immédiat, avant tout navigateur. `--behind-proxy` (ou `SMOKE_BEHIND_PROXY=1`)
 * **exige** ce que seul Caddy fournit — `401` sur `/admin`, `X-Robots-Tag`,
 * HSTS — ; sans lui, ces vérifications sont sautées, marquées « attendent le
 * proxy », et **comptées en fin d'exécution** avec leur raison : le reporter
 * `list` n'imprime qu'un tiret devant un test sauté, sans le motif. En mode
 * proxy, **un test sauté est un échec** : la configuration écrit un rapport
 * JSON (`SMOKE_JSON_REPORT`), relu ici — un saut qui passerait pour vert
 * contre l'URL réelle prouverait le contraire de ce qu'on veut. Le test
 * n'appelle jamais le modèle.
 *
 * Tout autre argument est passé à Playwright tel quel (`--reporter`, `-g`…).
 * Codes de sortie : 2 = refus avant tout lancement ; sinon celui de
 * Playwright, ou 1 si un test a été sauté en mode proxy.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE =
  'Usage : npm run test:smoke -- --base-url <url> [--behind-proxy]\n' +
  "        (ou SMOKE_BASE_URL=<url> et SMOKE_BEHIND_PROXY=1 dans l'environnement)";

function refuse(message) {
  console.error(`Test de fumée refusé — ${message}\n${USAGE}`);
  process.exit(2);
}

/** Sépare ce qui est à ce script de ce qui est à Playwright. */
function parseArgs(argv) {
  let baseUrl;
  let behindProxy = false;
  const passthrough = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      baseUrl = argv[index + 1];
      if (baseUrl === undefined || baseUrl === '' || baseUrl.startsWith('-')) refuse('--base-url attend une URL.');
      index += 1;
    } else if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
      if (baseUrl === '') refuse('--base-url= est vide : une URL est attendue.');
    } else if (arg === '--behind-proxy') {
      behindProxy = true;
    } else {
      passthrough.push(arg);
    }
  }
  return {baseUrl, behindProxy, passthrough};
}

const {baseUrl: fromArgs, behindProxy: fromFlag, passthrough} = parseArgs(process.argv.slice(2));
const baseUrl = fromArgs ?? process.env.SMOKE_BASE_URL;
if (!baseUrl) refuse("aucune URL cible : --base-url <url> ou SMOKE_BASE_URL requis.");

let target;
try {
  target = new URL(baseUrl);
} catch {
  refuse(`« ${baseUrl} » n'est pas une URL.`);
}
if (target.protocol !== 'http:' && target.protocol !== 'https:') {
  refuse(`« ${baseUrl} » doit être en http ou https.`);
}

const proxyEnv = process.env.SMOKE_BEHIND_PROXY;
if (proxyEnv !== undefined && proxyEnv !== '' && proxyEnv !== '0' && proxyEnv !== '1') {
  refuse(`SMOKE_BEHIND_PROXY vaut « ${proxyEnv} » : seules les valeurs 1 (exiger Caddy) et 0 (ou rien) sont admises.`);
}
const behindProxy = fromFlag || proxyEnv === '1';

const require = createRequire(import.meta.url);
let playwrightCli;
try {
  playwrightCli = require.resolve('@playwright/test/cli');
} catch {
  refuse('@playwright/test introuvable : npm ci --include=dev.');
}

// Le rapport JSON : celui que l'appelant demande (`SMOKE_JSON_REPORT`, conservé),
// sinon un fichier temporaire, effacé après lecture.
const rapportDemande = process.env.SMOKE_JSON_REPORT;
const dossierTemporaire = rapportDemande ? undefined : mkdtempSync(join(tmpdir(), 'cv-site-smoke-'));
const rapport = rapportDemande || join(dossierTemporaire, 'rapport.json');

console.log(`Test de fumée contre ${target.origin}`);
console.log(
  behindProxy
    ? 'Mode : derrière Caddy — 401 sur /admin, X-Robots-Tag, HSTS et X-Client-IP-Seen sont exigés ; un test sauté est un échec.'
    : 'Mode : sans proxy — les vérifications qui dépendent de Caddy (401 sur /admin, X-Robots-Tag, HSTS, X-Client-IP-Seen) seront sautées et comptées en fin d\'exécution (--behind-proxy pour les exiger).'
);

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config', 'playwright.smoke.config.ts', ...passthrough],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      SMOKE_BASE_URL: target.origin,
      SMOKE_BEHIND_PROXY: behindProxy ? '1' : '0',
      SMOKE_JSON_REPORT: rapport
    }
  }
);
if (result.error) refuse(`Playwright n'a pas pu être lancé : ${result.error.message}`);

/** Les tests sautés du rapport JSON de Playwright : titre complet et raison. */
function sautes(suite, chemin = []) {
  const trouves = [];
  const titres = suite.title ? [...chemin, suite.title] : chemin;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status !== 'skipped') continue;
      const raison = (test.annotations ?? []).find((a) => a.type === 'skip' || a.type === 'fixme')?.description;
      trouves.push({titre: [...titres, spec.title].join(' › '), raison: raison ?? '(sans raison)'});
    }
  }
  for (const sous of suite.suites ?? []) trouves.push(...sautes(sous, titres));
  return trouves;
}

let liste;
if (existsSync(rapport)) {
  try {
    const json = JSON.parse(readFileSync(rapport, 'utf8'));
    liste = (json.suites ?? []).flatMap((suite) => sautes(suite));
  } catch (error) {
    console.error(`Rapport JSON illisible (${rapport}) : ${error.message}`);
  }
}
if (dossierTemporaire) rmSync(dossierTemporaire, {recursive: true, force: true});

let code = result.status ?? 1;
if (liste === undefined) {
  console.error(`Aucun rapport JSON lu (${rapport}) : les tests sautés n'ont pas pu être comptés.`);
  if (behindProxy) code = Math.max(code, 1);
} else if (liste.length > 0) {
  const lignes = liste.map(({titre, raison}) => `  - ${titre} — ${raison}`).join('\n');
  if (behindProxy) {
    console.error(`Mode proxy : ${liste.length} vérification(s) sautée(s), ce qui vaut échec :\n${lignes}`);
    code = Math.max(code, 1);
  } else {
    console.log(`${liste.length} vérification(s) attendent le proxy — sautées, pas vertes :\n${lignes}`);
  }
} else if (!behindProxy) {
  console.log('Aucune vérification sautée.');
}
process.exit(code);
