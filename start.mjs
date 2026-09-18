/**
 * Démarrage en production — ce que le service Windows exécute (story 11).
 *
 * Sur le VPS, le cadre commun (`dotfiles/vps` : `apps.json`, `service.ps1`,
 * `deploy.ps1`) lance `node start.mjs` dans `C:\Apps\cv-site\current\`, sous
 * NSSM, avec `NODE_ENV=production` pour tout environnement. Il ne charge aucun
 * `.env` et n'impose aucune interface d'écoute : ce fichier fait les deux, puis
 * lance l'artefact autonome — que `next start` refuse (`output: 'standalone'`,
 * AD-1, AD-13). Dans l'ordre :
 *
 *  1. **`.env.local`**, posé à côté (copié depuis `shared\` par `deploy.ps1`),
 *     est chargé **sans écraser** une variable déjà présente : l'environnement
 *     du service prime, comme avec `node --env-file` — une variable présente
 *     mais vide vaut absente, comme dans `src/env.ts`. Absent, ce n'est pas une
 *     erreur — les tests navigateur et l'intégration continue posent tout par
 *     l'environnement. Illisible pour une autre raison, le démarrage échoue
 *     avec le message : mieux vaut ne rien servir qu'un site sans sa clé. Le
 *     fichier doit être en **UTF-8** : une marque d'ordre des octets en tête
 *     est retirée (Node ne le fait pas, la première clé serait perdue) ; un
 *     fichier en UTF-16 — ce que `Out-File` et `>` de PowerShell 5.1 écrivent
 *     par défaut — ou binaire est refusé, avec le remède, plutôt que de ne
 *     charger aucune clé en silence et d'échouer plus loin sur un message qui
 *     accuserait la clé. Sous `NODE_ENV=production` posé **avant** ce fichier
 *     (le service), un `ANTHROPIC_BASE_URL` non vide venu **du fichier** est
 *     refusé : le site viserait un simulateur au lieu de l'API ; posé par
 *     l'environnement (tests navigateur), il n'est pas concerné.
 *     `START_SKIP_ENV_FILE=1` saute la lecture du fichier : les tests
 *     navigateur (`playwright.config.ts`, `webServer.env`) le posent pour que
 *     l'artefact ne dépende de rien d'autre que ce qu'ils lui donnent — hermétiques
 *     sur tout poste, `.env.local` présent ou non.
 *  2. **`HOSTNAME`** vaut `127.0.0.1` s'il manque ou s'il est vide :
 *     `server.js` écouterait sinon sur `0.0.0.0` — toutes les interfaces —
 *     alors que Caddy est la seule porte publique (AD-10). `src/env.ts` a le
 *     même défaut, mais il ne parle qu'à l'application ; l'interface d'écoute
 *     est décidée avant elle, par `server.js`, qui lit l'environnement brut.
 *     En production, une interface hors boucle locale est un choix explicite
 *     de l'opérateur : elle passe, avec une ligne d'avertissement.
 *  3. **`.next/standalone/server.js`** est importé — après avoir vérifié que
 *     l'artefact est **complet** : `.next/standalone/.next/static` doit être
 *     là (`scripts/postbuild.mjs`, enchaîné par `npm run build`), sinon les
 *     pages sortiraient sans style et chaque script répondrait 404. Il se place
 *     dans son dossier, lit `PORT` et `HOSTNAME`, et sert.
 *
 * Aucune dépendance, aucun import de `src/` : ce fichier tourne avant que quoi
 * que ce soit de l'application n'existe. Il n'affiche jamais une valeur de
 * configuration — seulement l'interface et le port d'écoute.
 *
 * Preuve : `tests/unit/start.test.ts` le lance en sous-processus contre un
 * `server.js` factice ; les tests navigateur (`npm run test:e2e`) démarrent
 * l'artefact réel par `npm run start`, donc par ce fichier.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(ROOT, '.env.local');
const STANDALONE = resolve(ROOT, '.next', 'standalone');
const SERVER = resolve(STANDALONE, 'server.js');
const STATIC = resolve(STANDALONE, '.next', 'static');
/** La boucle locale : Caddy est la seule porte publique (AD-10). */
const LOOPBACK = '127.0.0.1';
const LOOPBACKS = new Set(['127.0.0.1', 'localhost', '::1']);

function refuse(message) {
  console.error(`Démarrage refusé — ${message}`);
  process.exit(1);
}

function log(level, event, fields) {
  console.log(JSON.stringify({level, event, ...fields}));
}

/**
 * Lit et analyse un fichier `.env`. Rend `null` s'il n'existe pas ; lève pour
 * toute autre erreur — droits, répertoire à sa place, disque — et pour un
 * encodage qui n'est pas de l'UTF-8.
 */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new Error(`${path} illisible : ${error && error.message ? error.message : String(error)}`);
  }
  // UTF-16 (marque FF FE ou FE FF, illisible en UTF-8 → U+FFFD ; caractères
  // ASCII entrelacés de NUL) ou binaire : aucune clé ne serait reconnue.
  if (text.charCodeAt(0) === 0xfffd || text.includes('\0')) {
    throw new Error(
      `${path} est en UTF-16 ou binaire, attendu UTF-8 — l'écrire avec Out-File -Encoding utf8 (une marque d'ordre des octets UTF-8 est tolérée).`
    );
  }
  // Une seule marque, en tête ; ailleurs, c'est un caractère comme un autre.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseEnv(text);
}

/** Vrai si la variable n'est pas posée, ou posée vide : le fichier peut alors la fournir. */
function unset(value) {
  return value === undefined || value === '';
}

// `NODE_ENV=production` **avant** le fichier : c'est le service (NSSM), pas un
// `npm start` ni le `webServer` des tests navigateur, qui ne le posent pas.
const productionService = process.env.NODE_ENV === 'production';

let envFile = 'skipped';
if (process.env.START_SKIP_ENV_FILE !== '1') {
  let parsed;
  try {
    parsed = readEnvFile(ENV_FILE);
  } catch (error) {
    refuse(error.message);
  }
  if (parsed === null) {
    envFile = 'absent';
  } else {
    if (productionService && !unset(parsed.ANTHROPIC_BASE_URL)) {
      refuse(
        `${ENV_FILE} porte ANTHROPIC_BASE_URL : le site viserait un simulateur au lieu de l'API. Retirer la ligne, ou la laisser vide (voir .env.example).`
      );
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (unset(process.env[key])) process.env[key] = value;
    }
    envFile = 'loaded';
  }
}

// `!` et non `??` : vide vaut absent, comme dans `server.js` (`HOSTNAME || '0.0.0.0'`).
if (!process.env.HOSTNAME) process.env.HOSTNAME = LOOPBACK;

if (!existsSync(SERVER)) {
  refuse(`artefact autonome absent : ${SERVER}. Lancer npm run build d'abord.`);
}
if (!existsSync(STATIC)) {
  refuse(
    `artefact incomplet : ${STATIC} absent — postbuild n'a pas tourné (npm run build l'enchaîne ; à la main : node scripts/postbuild.mjs).`
  );
}

log('info', 'start.environment', {
  envFile,
  hostname: process.env.HOSTNAME,
  port: process.env.PORT || '3000'
});
if (process.env.NODE_ENV === 'production' && !LOOPBACKS.has(process.env.HOSTNAME)) {
  log('warn', 'start.hostname_not_loopback', {
    hostname: process.env.HOSTNAME,
    text: `HOSTNAME=${process.env.HOSTNAME} en production : Node écoute hors de la boucle locale, alors que Caddy est la seule porte publique (AD-10). Choix de l'opérateur — vérifier que le pare-feu tient.`
  });
}

await import(pathToFileURL(SERVER).href);
