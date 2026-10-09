/**
 * Les migrations de schéma de `usage.db` — AD-7, story 12.
 *
 * Jusqu'à la mise en ligne, une base d'une version antérieure se recréait : il
 * n'y avait rien à garder. La base de production porte désormais de vraies
 * visites, et le DDL idempotent ne sait pas rattraper un écart — il ne rejoue
 * que des `IF NOT EXISTS`. D'où ce tableau de pas `n → n+1`, joué à
 * l'ouverture par `applySchema()` (`./db.ts`), de `user_version + 1` jusqu'à
 * `SCHEMA_VERSION`.
 *
 * Quatre règles, qui sont tout l'intérêt du mécanisme :
 *
 *  1. **La sonde d'écriture d'abord.** Une base en lecture seule est refusée
 *     avant qu'un seul octet soit écrit : sinon elle laisserait une copie de
 *     sauvegarde orpheline derrière elle, et la tentative suivante prendrait
 *     cette copie pour l'état d'avant une migration qui n'a jamais eu lieu.
 *  2. **Une copie avant de toucher à quoi que ce soit**, par `VACUUM INTO`
 *     dans le répertoire de la base (`DATA_DIR`), nommée d'après la version
 *     **quittée** — `usage-v4.db` pour un passage de 4 à 5. Une base migrée
 *     n'ouvre plus avec le code précédent, qui refuse une version plus récente
 *     que lui : `deploy.ps1` restaure cette copie avant tout retour arrière,
 *     automatique ou manuel (README, `dotfiles/vps/vps.md`). Si le nom
 *     canonique est déjà pris, la copie est **horodatée** plutôt que sautée :
 *     une copie de trop ne coûte rien, une copie absente coûte la journée.
 *  3. **Un pas, une transaction.** Les instructions du pas et le nouveau
 *     `PRAGMA user_version` sont commis ensemble ou pas du tout : une base
 *     reste toujours à une version qui décrit vraiment son schéma, jamais
 *     entre deux.
 *  4. **Rien de destructeur, et rejouable sans effet.** Aucune suppression,
 *     aucune purge : un pas ajoute. Chaque pas vérifie d'abord que ce qu'il
 *     apporte n'est pas déjà là, pour qu'une reprise après incident ne bute
 *     pas sur son propre travail. `tests/unit/journal.test.ts` relit ce
 *     fichier et y refuse toute instruction destructive.
 *
 * Ce module n'ouvre aucune base et ne décide de rien : il reçoit la connexion
 * et le chemin de celui qui a ouvert (`./db.ts`).
 */
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {SCHEMA_VERSION, SESSION_LABEL_CHECK} from './schema';

/** Un pas de migration : il mène la base **à** `to`, depuis `to - 1`. */
export type Migration = {
  /** La version atteinte par ce pas. */
  readonly to: number;
  /** Ce que le pas apporte, en une ligne — affiché par `npm run migrate`. */
  readonly what: string;
  /** Les instructions du pas. Appelé **dans** une transaction déjà ouverte. */
  readonly up: (db: DatabaseSync) => void;
};

/** Vrai si la table porte déjà cette colonne — un pas rejoué ne refait rien. */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const row = db
    .prepare('SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) as {n: number};
  return row.n > 0;
}

/**
 * Les pas, dans l'ordre, un par version. Le premier mène de 4 à 5 : la base de
 * la story 11 est la première qu'il a fallu convertir plutôt que recréer.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    to: 5,
    what: "session.label — l'étiquette du lien par lequel une session est arrivée",
    up: (db) => {
      // `ALTER TABLE … ADD COLUMN` sur une table `STRICT` : accepté, la colonne
      // est nullable et sans valeur par défaut, donc les lignes existantes
      // reçoivent `NULL` — exactement ce qu'une session arrivée par une adresse
      // nue vaut. Aucune réécriture de table, aucune ligne touchée.
      //
      // Le `CHECK` est celui du DDL, au mot près (`SESSION_LABEL_CHECK`) : une
      // base migrée et une base neuve doivent porter la **même** contrainte,
      // sinon la seule garde qui protège la colonne d'un appelant futur ne vaut
      // que sur l'une des deux. SQLite ne l'évalue pas sur les lignes déjà là —
      // elles valent `NULL`, que la contrainte admet.
      if (!hasColumn(db, 'session', 'label')) {
        db.exec(`ALTER TABLE session ADD COLUMN label TEXT CHECK (${SESSION_LABEL_CHECK})`);
      }
    }
  }
];

/**
 * Vérifie que le tableau décrit une suite continue de versions, une par pas,
 * qui s'achève sur la version du schéma. Appelé au **chargement** du module :
 * un pas en double, un trou, ou un `SCHEMA_VERSION` relevé sans pas
 * correspondant arrête le processus au démarrage, pas à la première migration
 * sur la seule base qui porte de vraies données.
 */
export function assertMigrationChain(migrations: readonly Migration[], target: number): void {
  const versions = migrations.map((migration) => migration.to);
  if (new Set(versions).size !== versions.length) {
    throw new Error(
      `migrations.ts : deux pas déclarent la même version (${versions.join(', ')}) — un pas par version, pas deux`
    );
  }
  if (versions.length > 0) {
    if (versions.at(-1) !== target) {
      throw new Error(
        `migrations.ts : le dernier pas mène à la version ${versions.at(-1)}, alors que SCHEMA_VERSION vaut ${target} — un pas manque, ou SCHEMA_VERSION a été relevé sans lui`
      );
    }
    for (let index = 1; index < versions.length; index++) {
      if (versions[index]! !== versions[index - 1]! + 1) {
        throw new Error(
          `migrations.ts : les pas ne s'enchaînent pas de 1 en 1 (${versions.join(', ')}) — il manque la version ${versions[index - 1]! + 1}`
        );
      }
    }
  }
}

assertMigrationChain(MIGRATIONS, SCHEMA_VERSION);

/**
 * La plus ancienne version que ce code sait migrer — la version d'avant le
 * premier pas. En dessous, `./db.ts` refuse avec le remède : ces schémas-là
 * n'ont jamais atteint la production, leur base se recrée.
 */
export const FIRST_MIGRATABLE_VERSION =
  MIGRATIONS.length === 0 ? SCHEMA_VERSION : MIGRATIONS[0]!.to - 1;

/**
 * Le nom de la copie de sauvegarde d'une base quittant cette version.
 *
 * Avec un instant, le nom porte en plus l'horodatage : c'est ce qu'on écrit
 * quand le nom canonique est déjà pris — une base restaurée depuis la
 * sauvegarde nocturne peut très bien retrouver un `usage-v4.db` laissé par une
 * migration antérieure. Les deux-points et les points de l'horodatage laissent
 * place à des traits d'union : un nom de fichier Windows n'en accepte pas.
 *
 * `split`/`join` plutôt que la méthode de substitution des chaînes : son nom
 * est l'un des mots que `tests/unit/journal.test.ts` refuse dans les sources de
 * cette couche — même en commentaire (AD-7). Le garde est textuel, et il vaut
 * mieux écrire autrement que l'affaiblir.
 */
export function backupFile(version: number, at?: Date): string {
  if (at === undefined) return `usage-v${version}.db`;
  const stamp = at.toISOString().split(':').join('-').split('.').join('-');
  return `usage-v${version}-${stamp}.db`;
}

/** Ce qu'une migration a fait — ce que `npm run migrate` rapporte. */
export type MigrationReport = {
  /** La version d'où l'on partait. */
  readonly from: number;
  /** La version atteinte — `SCHEMA_VERSION`. */
  readonly to: number;
  /** Le chemin de la copie de la base **avant** migration, écrite par cet appel. */
  readonly backup: string;
  /** Vrai si le nom canonique était pris et que la copie porte un horodatage. */
  readonly backupStamped: boolean;
  /** Les pas joués, du premier au dernier. */
  readonly steps: readonly string[];
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copie la base, puis joue les pas de `from + 1` à `SCHEMA_VERSION`.
 *
 * Lève une `Error` qui dit quoi corriger — rien n'est alors commis, la base
 * reste à sa version. `./db.ts` referme la connexion et préfixe le message :
 * c'est ce que l'exploitant lit sur stderr avant que le processus sorte.
 */
export function runMigrations(db: DatabaseSync, path: string, from: number): MigrationReport {
  const plan: Migration[] = [];
  for (let version = from + 1; version <= SCHEMA_VERSION; version++) {
    const step = MIGRATIONS.find((migration) => migration.to === version);
    if (step === undefined) {
      // Invariante : `assertMigrationChain` au chargement et le plancher de
      // `./db.ts` ferment déjà les deux côtés. On ne joue pas un plan troué.
      throw new Error(
        `aucun pas de migration vers la version ${version} : le schéma a changé sans que ./migrations.ts suive`
      );
    }
    plan.push(step);
  }

  // La sonde d'écriture **avant** la copie : réécrire la version courante ne
  // change rien au contenu, mais échoue sur une base en lecture seule — ce qui
  // doit se savoir maintenant, et non après avoir laissé un `usage-v4.db` que
  // la tentative suivante prendrait pour l'état d'avant.
  try {
    db.exec(`PRAGMA user_version = ${from}`);
  } catch (error) {
    throw new Error(
      `migration impossible : la base n'est pas inscriptible (${reason(error)}) — rien n'a été copié ni migré`
    );
  }

  // `VACUUM INTO` écrit une base cohérente même pendant une écriture, et refuse
  // d'écraser un fichier existant. Un nom déjà pris n'est donc pas une reprise
  // dont on hériterait la copie : c'est une copie dont on ne sait rien, et on
  // en écrit une autre, horodatée. Cela règle du même coup la course entre le
  // service et `npm run migrate` ouvrant la même base en retard.
  const canonical = join(dirname(path), backupFile(from));
  const backupStamped = existsSync(canonical);
  const backup = backupStamped ? join(dirname(path), backupFile(from, new Date())) : canonical;
  try {
    db.prepare('VACUUM INTO ?').run(backup);
  } catch (error) {
    throw new Error(
      `copie de sauvegarde impossible avant migration (${backup}) : ${reason(error)} — le répertoire doit être inscriptible et avoir la place ; rien n'a été migré`
    );
  }

  const steps: string[] = [];
  for (const step of plan) {
    db.exec('BEGIN IMMEDIATE');
    try {
      step.up(db);
      // Dans la même transaction que le pas : la version décrit toujours le
      // schéma réel, même si le processus meurt entre deux pas.
      db.exec(`PRAGMA user_version = ${step.to}`);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite a pu annuler lui-même : ne pas masquer l'erreur d'origine.
      }
      throw new Error(
        `migration vers la version ${step.to} refusée : ${reason(error)} — la base reste en version ${step.to - 1}, et la copie ${backup} porte son état d'avant`
      );
    }
    steps.push(`${step.to} — ${step.what}`);
  }

  console.info(
    JSON.stringify({
      level: 'info',
      event: 'journal.migrated',
      from,
      to: SCHEMA_VERSION,
      backup,
      backupStamped,
      steps: steps.length,
      text: `Schéma de usage.db migré de la version ${from} à ${SCHEMA_VERSION}.`
    })
  );
  return {from, to: SCHEMA_VERSION, backup, backupStamped, steps};
}
