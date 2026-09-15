/**
 * L'ouverture de `usage.db` — AD-7 : `journal` est le seul module qui l'ouvre,
 * et il ne l'ouvre qu'une fois par processus.
 *
 * `node:sqlite` est natif à Node 24 : aucune dépendance, aucun binaire à
 * recompiler. `DatabaseSync` est synchrone, ce qui convient à un journal
 * d'insertion à faible débit et rend chaque écriture atomique du point de vue
 * du code appelant.
 *
 * Deux portes :
 *  - `journal()` — pour l'application : ouvre `DATA_DIR/usage.db` au premier
 *    appel, puis rend toujours la même connexion. `ensureJournalOpen()`
 *    (`src/lib/startup.ts`) l'appelle à l'amorçage : un `DATA_DIR` inexistant
 *    ou non inscriptible arrête le processus, il ne reste pas debout à moitié
 *    (AD-2, AD-9) ;
 *  - `openJournal(path)` — pour les tests : la même ouverture, sur une base
 *    temporaire, qui devient le journal du processus jusqu'à `closeJournal()`.
 */
import {existsSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {env} from '@/env';
import {DDL, PRAGMAS, SCHEMA_VERSION} from './schema';

/** Le nom du fichier dans `DATA_DIR`. */
export const JOURNAL_FILE = 'usage.db';

/**
 * Le porte-connexion vit sur `globalThis`, pas dans une variable de module :
 * Turbopack construit **trois** graphes de modules pour le serveur — amorçage,
 * pages, routes — chacun avec sa propre copie de ce fichier. Une variable de
 * module donnerait donc trois connexions par processus, ouvertes à trois
 * moments ; une clé globale n'en donne qu'une, quelle que soit la copie qui
 * l'a ouverte. Même mécanisme que celui recommandé pour un client Prisma.
 */
type Holder = {db: DatabaseSync | null};
const HOLDER = Symbol.for('cv-site.journal');
const holder: Holder = ((globalThis as unknown as Record<symbol, Holder | undefined>)[HOLDER] ??=
  {db: null});

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pose les réglages de connexion, crée ce qui manque, et stampe la version.
 *
 * `PRAGMA user_version = N` s'exécute à **chaque** ouverture, même quand la
 * base est déjà à jour : c'est aussi la sonde d'écriture. Un `BEGIN IMMEDIATE`
 * vide ne touche pas au fichier en mode WAL et laisserait passer une base en
 * lecture seule, dont l'échec n'apparaîtrait qu'à la première visite.
 */
function applySchema(db: DatabaseSync): void {
  for (const pragma of PRAGMAS) db.exec(pragma);

  // Un système de fichiers qui refuse le WAL (partage réseau) garde le mode
  // précédent en silence ; tout ce que ce module suppose du verrouillage
  // serait alors faux. Mieux vaut le savoir au démarrage.
  const {journal_mode: mode} = db.prepare('PRAGMA journal_mode').get() as {journal_mode: string};
  if (mode !== 'wal') {
    throw new Error(`journal_mode « ${mode} » : ce système de fichiers refuse le mode WAL`);
  }

  const {user_version: version} = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `schéma en version ${version}, ce code ne connaît que la version ${SCHEMA_VERSION} — la base a été écrite par une version plus récente du site`
    );
  }
  if (version === 0) {
    // Une base sans version mais déjà peuplée n'est pas la nôtre : la
    // tamponner ferait accepter un schéma inconnu, dont l'écart n'apparaîtrait
    // qu'à la première visite, colonne manquante à l'appui.
    const {n: tables} = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as {n: number};
    if (tables > 0) {
      throw new Error(
        'base non vide sans version de schéma — ce fichier n’a pas été créé par ce site'
      );
    }
  }

  db.exec(DDL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Ouvre la base à ce chemin, applique le schéma (idempotent) et en fait le
 * journal du processus. Lève une `Error` dont le message dit quoi corriger :
 * c'est ce que `startup.ts` écrit sur stderr avant de sortir.
 */
export function openJournal(path: string): DatabaseSync {
  if (holder.db !== null) {
    throw new Error('Le journal est déjà ouvert : une seule connexion par processus (AD-7).');
  }

  const directory = dirname(path);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(
      `Journal inaccessible : le répertoire ${directory} n'existe pas — créer le répertoire ou corriger DATA_DIR (voir .env.example).`
    );
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    throw new Error(
      `Journal inaccessible : impossible d'ouvrir ${path} (${reason(error)}) — DATA_DIR doit être un répertoire inscriptible (voir .env.example).`
    );
  }

  try {
    applySchema(db);
  } catch (error) {
    db.close();
    // Même vocabulaire que les deux autres échecs : c'est ici qu'arrive une
    // base existante devenue en lecture seule, et l'exploitant doit lire le
    // même mot — inscriptible — et la même variable.
    throw new Error(
      `Journal inutilisable : ${path} — ${reason(error)}. DATA_DIR doit être un répertoire inscriptible, et usage.db un fichier de ce site (voir .env.example).`
    );
  }

  holder.db = db;
  return db;
}

/** La connexion du processus, ouverte au premier appel sur `DATA_DIR/usage.db`. */
export function journal(): DatabaseSync {
  return holder.db ?? openJournal(join(env.DATA_DIR, JOURNAL_FILE));
}

/** Ferme la connexion courante — les tests, qui ouvrent une base par cas. */
export function closeJournal(): void {
  if (holder.db === null) return;
  const db = holder.db;
  holder.db = null;
  db.close();
}
