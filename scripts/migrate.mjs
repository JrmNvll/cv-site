/**
 * `npm run migrate` — met `usage.db` à la version du schéma que ce code
 * connaît, et dit ce qu'il a fait (story 12).
 *
 * Ce script ne migre rien lui-même : la migration vit dans `applySchema()`
 * (`src/journal/db.ts`), qui la joue **à l'ouverture** — c'est ce qui garantit
 * que le site ne peut jamais tourner sur une base en retard d'une colonne.
 * `npm run migrate` n'est donc qu'une ouverture-fermeture, pour que la
 * migration ait lieu au moment choisi par `deploy.ps1` : après le build (une
 * page qui interroge une colonne absente échouerait à la génération) et avant
 * la bascule (l'application démarre sur un schéma à jour). Le cadre commun
 * l'appelle déjà, par `npm run migrate --if-present` : rien à y changer.
 *
 * Sortie `0` sans rien faire quand il n'y a rien à jouer ; sortie `1` avec le
 * message de ce qui bloque — et rien n'est commis, la base reste à sa version.
 * Une `usage.db` absente est un **refus**, pas une création : c'est un outil de
 * migration, et un `DATA_DIR` mal recopié ne doit pas donner un déploiement
 * vert sur un journal neuf.
 *
 * Avant toute migration, le journal copie la base par `VACUUM INTO`, dans
 * `DATA_DIR`, sous le nom de la version quittée (`usage-v4.db`). **Le retour
 * arrière d'un déploiement joué après une migration exige de restaurer cette
 * copie** : le code précédent refuse une base plus récente que lui. C'est écrit
 * dans le README et dans `dotfiles/vps/vps.md`.
 *
 * Usage :
 *   npm run migrate              (DATA_DIR vient de .env.local, ou de l'environnement)
 *   node scripts/migrate.mjs
 */
import {existsSync, readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');
const ENV_FILE = resolve(ROOT, '.env.local');

/**
 * Node sait retirer les types d'un `.ts`, mais ni résoudre un import sans
 * extension, ni l'alias `@/` du `tsconfig`, ni la condition `react-server` que
 * `server-only` attend. Ce crochet fait les trois, et seulement ça : la couche
 * `journal` garde le style du reste du dépôt plutôt que de se tordre pour un
 * script. Même mécanisme que `scripts/check-content.mjs`.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    // `server-only` (chargé par `@/env`) lève hors d'un composant serveur :
    // c'est un marqueur pour le compilateur de React, pas une garde d'exécution.
    const conditions = context.conditions?.includes('react-server')
      ? context.conditions
      : [...(context.conditions ?? []), 'react-server'];

    let target = specifier;
    if (specifier.startsWith('@/')) {
      target = pathToFileURL(resolve(SRC, specifier.slice(2))).href;
    }
    // Un spécifieur de fichier sans extension : `@/env` → `env.ts`.
    const relative = target.startsWith('.') || target.startsWith('file:');
    if (relative && !/\.[cm]?[jt]sx?$/.test(target)) {
      const candidate = new URL(`${target}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) target = `${target}.ts`;
    }
    const resolved = nextResolve(target, {...context, conditions});
    // `format` explicite : sans lui, Node ré-analyse chaque `.ts` pour deviner
    // s'il est ESM et le dit bruyamment à chaque exécution.
    return target.endsWith('.ts') ? {...resolved, format: 'module-typescript'} : resolved;
  }
});

function refuse(message) {
  console.error(`Migration refusée — ${message}`);
  process.exit(1);
}

/** Le message d'une erreur, quelle qu'en soit la forme. */
function cause(error) {
  return error && error.message ? error.message : String(error);
}

/**
 * Charge `.env.local` **sans écraser** l'environnement, comme `start.mjs` :
 * `deploy.ps1` le copie dans la release avant d'appeler ce script, et c'est
 * `src/env.ts` — et lui seul — qui lit et valide la configuration (AD-9).
 * Absent, ce n'est pas une erreur : l'environnement peut tout porter.
 */
function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return 'absent';
  let text;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch (error) {
    refuse(`${ENV_FILE} illisible : ${cause(error)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // `parseEnv` lève sur un fichier mal formé : une trace Node brute au milieu
  // d'un déploiement ne dirait pas où regarder.
  let parsed;
  try {
    parsed = parseEnv(text);
  } catch (error) {
    refuse(`${ENV_FILE} illisible : ${cause(error)} — une clé par ligne, sans guillemets (voir .env.example)`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
  return 'loaded';
}

/**
 * La base est-elle lisible ? Une ouverture en **lecture seule** et un pragma,
 * avant toute tentative d'écriture : un fichier qui n'est pas une base de ce
 * site doit donner le « Migration refusée » que l'exploitant attend, et non une
 * trace Node brute au milieu d'un déploiement. La version n'est pas gardée —
 * c'est le rapport de migration qui dit d'où l'on part.
 */
function verifierLisible(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    db.prepare('PRAGMA user_version').get();
  } finally {
    db.close();
  }
}

loadEnvFile();

let env;
let journalDb;
try {
  ({env} = await import('@/env'));
  journalDb = await import('@/journal/db');
} catch (error) {
  refuse(cause(error));
}

const {JOURNAL_FILE, closeJournal, lastMigration, openJournal} = journalDb;
const path = resolve(env.DATA_DIR, JOURNAL_FILE);

// **Un outil de migration, pas un outil de création.** Ouvrir ici créerait une
// base vide, la tamponnerait à la version courante et sortirait `0` : un
// `DATA_DIR` mal recopié donnerait un déploiement vert, un journal neuf, et la
// vraie base jamais migrée. C'est le site, au démarrage, qui crée la base — et
// lui seul.
if (!existsSync(path)) {
  refuse(
    `aucune base à migrer : ${path} n'existe pas. Vérifier DATA_DIR — le site crée usage.db à son premier démarrage, ce script ne le fait pas.`
  );
}

try {
  verifierLisible(path);
} catch (error) {
  refuse(`${path} illisible : ${cause(error)} — DATA_DIR doit désigner une base de ce site.`);
}

let db;
try {
  // L'ouverture migre : sonde d'écriture, copie de sauvegarde, puis un pas par
  // version, chacun en transaction. Elle lève un message qui dit quoi corriger.
  db = openJournal(path);
} catch (error) {
  refuse(cause(error));
}

// Ce que la migration a fait, de la bouche de celui qui l'a faite.
const rapport = lastMigration();
const {user_version: apres} = db.prepare('PRAGMA user_version').get();
closeJournal();

if (rapport === null) {
  console.log(`Rien à migrer : ${path} est déjà en version ${apres}.`);
} else {
  console.log(`Migration faite : ${path} passe de la version ${rapport.from} à ${rapport.to}.`);
  for (const pas of rapport.steps) console.log(`  version ${pas}`);
  console.log(
    `Copie d'avant migration : ${rapport.backup}${rapport.backupStamped ? ' (nom canonique déjà pris, copie horodatée)' : ''} — c'est elle qu'il faut restaurer pour revenir au code précédent.`
  );
}
// `exitCode` et non `exit()` : sur un tube — ce que `deploy.ps1` journalise —
// une sortie immédiate peut tronquer ce qui vient d'être écrit.
process.exitCode = 0;
