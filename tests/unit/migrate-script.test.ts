/**
 * `npm run migrate` (`scripts/migrate.mjs`, story 12) — prouvé en
 * **sous-processus**, sur une vraie base dans un dossier temporaire.
 *
 * C'est le seul morceau de la story que le déploiement appelle vraiment
 * (`deploy.ps1`, après le build et avant la bascule), et il atteint la couche
 * `journal` par un chemin qui n'existe nulle part ailleurs : un crochet de
 * résolution (`registerHooks`) pour l'alias `@/` et l'extension `.ts`, la
 * condition `react-server` pour que `server-only` reste inerte, et le
 * retrait de types de Node. Rien de tout cela n'est exercé par un test en
 * processus — il faut lancer le script.
 *
 * Ce qui est prouvé ici : une base absente est un **refus** (un `DATA_DIR` mal
 * recopié ne doit pas donner un déploiement vert sur un journal neuf), une base
 * à jour ne fait rien et sort `0`, une base en version 4 est migrée avec sa
 * copie et le rapport de ce qui a été joué, et une base trop ancienne est
 * refusée avec son remède. Le code de sortie et la sortie standard comptent :
 * c'est ce que `deploy.ps1` journalise.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DDL, SCHEMA_VERSION} from '@/journal/schema';
import {DDL_V4, DDL_V4_EST_DERIVE} from './journal-v4';

const MIGRATE = fileURLToPath(new URL('../../scripts/migrate.mjs', import.meta.url));
const RACINE = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Les variables que le script lit par `src/env.ts` — toutes posées ici, non
 * vides, pour que le `.env.local` du poste ne puisse rien y changer : le
 * chargement du fichier ne remplit que ce qui manque, comme `start.mjs`.
 * `tests/setup-env.ts` en pose certaines pour les tests unitaires ; le
 * sous-processus, lui, ne doit dépendre que de ce tableau.
 */
function environnement(dataDir: string): Record<string, string> {
  return {
    DATA_DIR: dataDir,
    CONTENT_DIR: join(RACINE, 'tests', 'fixtures', 'content'),
    ANTHROPIC_API_KEY: 'cle-de-test-sans-valeur',
    // Une URL valide et fermée : aucun appel n'est fait, mais la variable doit
    // être déterministe plutôt que venir du poste.
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    NEXT_PUBLIC_SITE_URL: 'https://exemple.invalid'
  };
}

let dossier: string;
let base: string;

/** Lance `node scripts/migrate.mjs` sur ce `DATA_DIR`. */
function migrer(dataDir = dossier) {
  return spawnSync(process.execPath, [MIGRATE], {
    cwd: RACINE,
    env: {...process.env, ...environnement(dataDir)},
    encoding: 'utf8',
    timeout: 60_000
  });
}

/** Une base à ce DDL, tamponnée à cette version, refermée aussitôt. */
function ecrireBase(ddl: string, version: number): void {
  const db = new DatabaseSync(base);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(ddl);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

/** Une session, pour prouver qu'une migration ne perd pas de ligne. */
function insererSession(): string {
  const db = new DatabaseSync(base);
  const visiteur = '01K4EXAMPVSTR0000000000000';
  const session = '01K4EXAMPSESS0000000000000';
  db.prepare('INSERT INTO visitor (id, first_seen) VALUES (?, ?)').run(visiteur, '2026-10-08T10:00:00.000Z');
  db.prepare(
    `INSERT INTO session (id, visitor_id, ip, user_agent, referer, lang, started_at, last_seen_at)
     VALUES (?, ?, '203.0.113.7', NULL, NULL, 'fr', ?, ?)`
  ).run(session, visiteur, '2026-10-08T10:00:00.000Z', '2026-10-08T10:00:00.000Z');
  db.close();
  return session;
}

function version(chemin: string): number {
  const db = new DatabaseSync(chemin, {readOnly: true});
  try {
    return (db.prepare('PRAGMA user_version').get() as {user_version: number}).user_version;
  } finally {
    db.close();
  }
}

function copies(): string[] {
  return readdirSync(dossier)
    .filter((nom) => nom.startsWith('usage-v'))
    .sort();
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'cv-site-migrate-'));
  base = join(dossier, 'usage.db');
});

afterEach(() => {
  rmSync(dossier, {recursive: true, force: true});
});

describe('npm run migrate', () => {
  it('refuse quand aucune usage.db nʼexiste : un DATA_DIR mal recopié nʼest pas un déploiement vert', () => {
    const resultat = migrer();

    // Créer une base vide et sortir `0` laisserait la vraie base jamais migrée.
    expect(resultat.status).toBe(1);
    expect(resultat.stderr).toContain('Migration refusée');
    expect(resultat.stderr).toContain('DATA_DIR');
    expect(resultat.stdout).toBe('');
    expect(existsSync(base)).toBe(false);
  });

  it('ne fait rien sur une base déjà à jour, et sort 0', () => {
    ecrireBase(DDL, SCHEMA_VERSION);

    const resultat = migrer();

    expect(resultat.stderr).toBe('');
    expect(resultat.status).toBe(0);
    expect(resultat.stdout).toContain('Rien à migrer');
    expect(resultat.stdout).toContain(`version ${SCHEMA_VERSION}`);
    expect(version(base)).toBe(SCHEMA_VERSION);
    // Rien à migrer, donc aucune copie de sauvegarde.
    expect(copies()).toEqual([]);
  });

  it('migre une base en version 4 : copie écrite, pas joués dits, lignes gardées — puis plus rien à faire', () => {
    expect(DDL_V4_EST_DERIVE).toBe(true);
    ecrireBase(DDL_V4, 4);
    const session = insererSession();

    const resultat = migrer();

    expect(resultat.stderr).toBe('');
    expect(resultat.status).toBe(0);
    // Ce que l'exploitant lit : d'où à où, le pas joué, et la copie à restaurer.
    expect(resultat.stdout).toContain('Migration faite');
    expect(resultat.stdout).toContain('de la version 4 à 5');
    expect(resultat.stdout).toContain('session.label');
    expect(resultat.stdout).toContain('usage-v4.db');
    expect(resultat.stdout).toContain('restaurer');
    // La ligne `journal.migrated` du journal applicatif est là aussi.
    expect(resultat.stdout).toContain('"event":"journal.migrated"');

    expect(version(base)).toBe(SCHEMA_VERSION);
    expect(copies()).toEqual(['usage-v4.db']);
    expect(version(join(dossier, 'usage-v4.db'))).toBe(4);

    // La session d'avant est toujours là, sans étiquette, et la colonne existe.
    const relue = new DatabaseSync(base, {readOnly: true});
    expect(relue.prepare('SELECT id, label FROM session').all()).toEqual([{id: session, label: null}]);
    relue.close();

    // Rejoué : rien à faire, et aucune seconde copie.
    const encore = migrer();
    expect(encore.status).toBe(0);
    expect(encore.stdout).toContain('Rien à migrer');
    expect(copies()).toEqual(['usage-v4.db']);
  });

  it('refuse une base trop ancienne, avec son remède, sans rien écrire', () => {
    // La version 1 n'a jamais atteint la production : aucun pas n'y mène, et le
    // refus doit dire quoi faire.
    ecrireBase(DDL_V4, 1);

    const resultat = migrer();

    expect(resultat.status).toBe(1);
    expect(resultat.stderr).toContain('Migration refusée');
    expect(resultat.stderr).toContain('recréer usage.db');
    expect(resultat.stdout).toBe('');
    expect(version(base)).toBe(1);
    expect(copies()).toEqual([]);
  });
});
