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
import {FIRST_MIGRATABLE_VERSION, runMigrations, type MigrationReport} from './migrations';
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
type Holder = {db: DatabaseSync | null; migration: MigrationReport | null};
const HOLDER = Symbol.for('cv-site.journal');
const holder: Holder = ((globalThis as unknown as Record<symbol, Holder | undefined>)[HOLDER] ??= {
  db: null,
  migration: null
});

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pose les réglages de connexion, migre ce qui est en retard, crée ce qui
 * manque, et stampe la version.
 *
 * `PRAGMA user_version = N` s'exécute à **chaque** ouverture, même quand la
 * base est déjà à jour : c'est aussi la sonde d'écriture. Un `BEGIN IMMEDIATE`
 * vide ne touche pas au fichier en mode WAL et laisserait passer une base en
 * lecture seule, dont l'échec n'apparaîtrait qu'à la première visite.
 *
 * La migration a lieu **ici**, et pas dans un outil à part : le site ne peut
 * alors jamais tourner sur une base en retard d'une colonne, et
 * `npm run migrate` n'est qu'une ouverture-fermeture (`scripts/migrate.mjs`)
 * que `deploy.ps1` provoque après le build, avant la bascule.
 */
function applySchema(db: DatabaseSync, path: string): void {
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
  if (version > SCHEMA_VERSION || version < 0) {
    // Plus récente que ce code, ou une valeur qu'aucune version n'a jamais
    // écrite : dans les deux cas, ce n'est pas une base qu'on sait lire.
    throw new Error(
      `schéma en version ${version}, ce code ne connaît que la version ${SCHEMA_VERSION} — la base a été écrite par une version plus récente du site, ou n'est pas la sienne`
    );
  }
  if (version > 0 && version < FIRST_MIGRATABLE_VERSION) {
    // Plus ancienne que le premier pas : ces schémas n'ont jamais atteint la
    // production — ils se recréaient, faute de données à garder. Écrire des
    // pas jamais éprouvés pour eux serait pire que de dire le remède.
    throw new Error(
      `schéma en version ${version}, ce code ne sait migrer qu'à partir de la version ${FIRST_MIGRATABLE_VERSION} — cette version n'a jamais atteint la production, recréer usage.db (supprimer le fichier et ses compagnons -wal et -shm, puis redémarrer)`
    );
  }
  if (version > 0 && version < SCHEMA_VERSION) {
    // Une base d'une version antérieure : le DDL ne rejoue que des `IF NOT
    // EXISTS`, il ne rattraperait pas une colonne qui manque. Les pas de
    // `./migrations.ts` s'en chargent, un par version, chacun en transaction,
    // précédés d'une copie de la base telle qu'elle était. Le rapport est
    // gardé pour `npm run migrate`, qui doit dire ce qu'il a fait.
    holder.migration = runMigrations(db, path, version);
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
  // Le rapport de migration appartient à **cette** ouverture : une base ouverte
  // après une autre ne doit pas hériter de ce que la précédente a migré.
  holder.migration = null;

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
    applySchema(db, path);
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

/**
 * Ce que la dernière ouverture a migré, ou `null` si elle n'a rien eu à faire.
 *
 * `npm run migrate` (`scripts/migrate.mjs`) le lit pour dire ce qu'il a fait —
 * les pas joués et le chemin de la copie — au lieu de le deviner en relisant
 * deux fois `PRAGMA user_version`. L'application, elle, n'en a pas l'usage :
 * la ligne `journal.migrated` suffit à ses journaux.
 */
export function lastMigration(): MigrationReport | null {
  return holder.migration;
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
