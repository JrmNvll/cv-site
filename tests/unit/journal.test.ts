/**
 * AD-7 / AD-14 — le journal : ce que `touchSession()` écrit, ce qu'il refuse
 * d'écrire, et ce que le module ne peut pas faire du tout.
 *
 * Chaque ligne de la matrice de la story est rejouée sur une base temporaire,
 * ouverte par la même fonction que l'application (`openJournal`) et fermée
 * après chaque cas — sur Windows, un répertoire dont un fichier est encore
 * ouvert ne se supprime pas. Aucune requête HTTP ici : le journal reçoit
 * visiteur, session, adresse, navigateur, provenance et langue en paramètres,
 * c'est précisément ce qui le rend testable sans monter Next.
 */
import {chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {closeJournal, JOURNAL_FILE, openJournal} from '@/journal/db';
import {BUSY_TIMEOUT_MS, DDL, SCHEMA_VERSION} from '@/journal/schema';
import {findSession, findVisitor, touchSession, type TouchSessionInput} from '@/journal';
import {ulid} from '@/lib/ulid';

const JOURNAL_SOURCES = fileURLToPath(new URL('../../src/journal', import.meta.url));
const NOW = new Date('2026-09-15T10:00:00.000Z');
const LATER = new Date('2026-09-15T10:05:00.000Z');
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const temporaires: string[] = [];
let db: DatabaseSync;
let path: string;

/** Une base neuve par cas, dans un répertoire jetable. */
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cv-journal-'));
  temporaires.push(dir);
  return dir;
}

/** Une visite complète, à retoucher : identifiants neufs à chaque appel. */
function visite(overrides: Partial<TouchSessionInput> = {}): TouchSessionInput {
  return {
    visitorId: ulid(NOW.getTime()),
    sessionId: ulid(NOW.getTime()),
    ip: '203.0.113.7',
    userAgent: 'Navigateur/1.0 (test)',
    referer: 'https://exemple.invalid/offre',
    lang: 'fr',
    now: NOW,
    ...overrides
  };
}

function count(table: 'visitor' | 'session' | 'exchange'): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n: number}).n;
}

/** La valeur d'un pragma — la colonne rendue ne porte pas toujours son nom. */
function pragma(name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

beforeEach(() => {
  path = join(dataDir(), JOURNAL_FILE);
  db = openJournal(path);
});

afterEach(() => {
  closeJournal();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const dir of temporaires) rmSync(dir, {recursive: true, force: true});
});

describe('première visite', () => {
  it('crée le visiteur puis la session, avec adresse, navigateur, provenance, langue et horodatages', () => {
    const entree = visite();

    const result = touchSession(entree);

    expect(result).toEqual({outcome: 'created', visitorCreated: true});
    expect(findVisitor(entree.visitorId)).toEqual({
      id: entree.visitorId,
      name: null,
      note: null,
      firstSeen: NOW.toISOString()
    });
    expect(findSession(entree.sessionId)).toEqual({
      id: entree.sessionId,
      visitorId: entree.visitorId,
      ip: '203.0.113.7',
      ipLabel: null,
      userAgent: 'Navigateur/1.0 (test)',
      referer: 'https://exemple.invalid/offre',
      lang: 'fr',
      startedAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString()
    });
    expect(count('visitor')).toBe(1);
    expect(count('session')).toBe(1);
    expect(count('exchange')).toBe(0);
  });

  it('accepte une visite sans provenance ni navigateur, et les garde nuls', () => {
    const entree = visite({userAgent: null, referer: null});

    touchSession(entree);

    const session = findSession(entree.sessionId)!;
    expect(session.userAgent).toBeNull();
    expect(session.referer).toBeNull();
  });

  it('horodate en ISO 8601 UTC, à la milliseconde, par défaut à lʼinstant courant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATER);
    const entree = visite({now: undefined});

    touchSession(entree);
    vi.useRealTimers();

    const session = findSession(entree.sessionId)!;
    expect(session.startedAt).toMatch(ISO_UTC);
    expect(session.startedAt).toBe(LATER.toISOString());
    expect(findVisitor(entree.visitorId)!.firstSeen).toBe(LATER.toISOString());
  });
});

describe('visite qui revient (session encore active)', () => {
  it('nʼinsère rien, prolonge last_seen_at et laisse provenance, navigateur et adresse inchangés', () => {
    const entree = visite();
    touchSession(entree);

    const result = touchSession({
      ...entree,
      ip: '198.51.100.9',
      userAgent: 'Autre/2.0',
      referer: 'https://autre.invalid/',
      lang: 'en',
      now: LATER
    });

    expect(result).toEqual({outcome: 'prolonged', visitorCreated: false});
    expect(count('visitor')).toBe(1);
    expect(count('session')).toBe(1);
    const session = findSession(entree.sessionId)!;
    expect(session.lastSeenAt).toBe(LATER.toISOString());
    expect(session.startedAt).toBe(NOW.toISOString());
    expect(session.ip).toBe('203.0.113.7');
    expect(session.userAgent).toBe('Navigateur/1.0 (test)');
    expect(session.referer).toBe('https://exemple.invalid/offre');
    expect(session.lang).toBe('fr');
  });

  it('ne fait jamais reculer last_seen_at : deux requêtes arrivées dans le désordre', () => {
    const entree = visite();
    touchSession({...entree, now: LATER});

    touchSession({...entree, now: NOW});

    expect(findSession(entree.sessionId)!.lastSeenAt).toBe(LATER.toISOString());
  });

  it('deux requêtes pour la même visite dans la même seconde nʼouvrent quʼune session', () => {
    const entree = visite();

    const premiere = touchSession(entree);
    const seconde = touchSession(entree);

    expect(premiere.outcome).toBe('created');
    expect(seconde.outcome).toBe('prolonged');
    expect(count('session')).toBe(1);
    // Une autre connexion — un second processus — attendrait le verrou au lieu
    // d'échouer en `SQLITE_BUSY`.
    expect(pragma('busy_timeout')).toBe(BUSY_TIMEOUT_MS);
  });
});

describe('retour après trente minutes', () => {
  it('rattache une nouvelle session au même visiteur', () => {
    const premiere = visite();
    touchSession(premiere);
    const seconde = visite({visitorId: premiere.visitorId, now: LATER});

    const result = touchSession(seconde);

    expect(result).toEqual({outcome: 'created', visitorCreated: false});
    expect(count('visitor')).toBe(1);
    expect(count('session')).toBe(2);
    expect(findSession(seconde.sessionId)!.visitorId).toBe(premiere.visitorId);
    expect(findVisitor(premiere.visitorId)!.firstSeen).toBe(NOW.toISOString());
  });
});

describe('identifiant de visiteur inconnu', () => {
  it('le traite comme une première visite : le visiteur est créé avec cet identifiant', () => {
    // Cookie forgé mais bien formé, ou base neuve devant un cookie ancien : le
    // journal n'a aucun moyen de faire la différence, et n'en a pas besoin.
    const choisi = '01K4EXAMPVSTR0000000000000';
    const entree = visite({visitorId: choisi});

    const result = touchSession(entree);

    expect(result).toEqual({outcome: 'created', visitorCreated: true});
    expect(findVisitor(choisi)).toBeDefined();
    expect(findSession(entree.sessionId)!.visitorId).toBe(choisi);
  });
});

describe('session connue dʼun autre visiteur', () => {
  it('nʼécrit rien, rend mismatch et journalise un avertissement', () => {
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legitime = visite();
    touchSession(legitime);
    const intrus = visite({sessionId: legitime.sessionId, now: LATER});

    const result = touchSession(intrus);

    expect(result).toEqual({outcome: 'mismatch', visitorCreated: false});
    expect(count('visitor')).toBe(1);
    expect(count('session')).toBe(1);
    expect(findVisitor(intrus.visitorId)).toBeUndefined();
    // Rien ne bouge, pas même `last_seen_at`.
    expect(findSession(legitime.sessionId)!.lastSeenAt).toBe(NOW.toISOString());
    expect(avertit).toHaveBeenCalledTimes(1);
    const ligne = JSON.parse(avertit.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(ligne.level).toBe('warn');
    expect(ligne.event).toBe('journal.session_mismatch');

    // Présentée en boucle, la même session n'est signalée qu'une fois : un
    // cookie forgé n'inonde pas le journal applicatif.
    touchSession(intrus);
    touchSession(intrus);
    expect(avertit).toHaveBeenCalledTimes(1);
    expect(count('session')).toBe(1);
  });
});

describe('identifiants invalides', () => {
  it.each([
    ['visiteur', {visitorId: 'pas-un-ulid'}],
    ['session', {sessionId: 'pas-un-ulid'}],
    ['session avec son horodatage', {sessionId: `${ulid()}.1757930400000`}]
  ])('refuse un %s qui nʼest pas un ULID, sans rien écrire', (_label, overrides) => {
    expect(() => touchSession(visite(overrides))).toThrowError(TypeError);
    expect(count('visitor')).toBe(0);
    expect(count('session')).toBe(0);
  });
});

describe('lecture', () => {
  it('rend undefined pour un visiteur ou une session inconnus', () => {
    expect(findVisitor(ulid())).toBeUndefined();
    expect(findSession(ulid())).toBeUndefined();
  });
});

describe('ouverture', () => {
  it('pose WAL, busy_timeout, foreign_keys et la version du schéma', () => {
    expect(pragma('journal_mode')).toBe('wal');
    // Une seconde, pas plus : `DatabaseSync` attend en bloquant la boucle Node.
    expect(pragma('busy_timeout')).toBe(BUSY_TIMEOUT_MS);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('user_version')).toBe(SCHEMA_VERSION);
  });

  it('crée les trois tables du squelette et les index de lecture', () => {
    const noms = (
      db
        .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
        .all() as {type: string; name: string}[]
    ).filter(({name}) => !name.startsWith('sqlite_'));

    expect(noms.filter(({type}) => type === 'table').map(({name}) => name)).toEqual([
      'exchange',
      'session',
      'visitor'
    ]);
    expect(noms.filter(({type}) => type === 'index').map(({name}) => name)).toEqual([
      'exchange_at',
      'exchange_session_id_at',
      'session_ip',
      'session_last_seen_at',
      'session_visitor_id'
    ]);
  });

  it('refuse une session sans visiteur : les clés étrangères sont appliquées par la base', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO session (id, visitor_id, ip, lang, started_at, last_seen_at)
           VALUES (?, ?, 'dev', 'fr', ?, ?)`
        )
        .run(ulid(), ulid(), NOW.toISOString(), NOW.toISOString())
    ).toThrowError(/FOREIGN KEY/);
  });

  it('rouvre une base existante sans effet : schéma inchangé, données intactes', () => {
    const entree = visite();
    touchSession(entree);
    const schema = db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    closeJournal();

    db = openJournal(path);

    expect(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(pragma('user_version')).toBe(SCHEMA_VERSION);
    expect(findSession(entree.sessionId)).toBeDefined();
    expect(count('visitor')).toBe(1);
  });

  it('refuse une seconde ouverture tant que la première est en cours : une connexion par processus', () => {
    expect(() => openJournal(join(dataDir(), JOURNAL_FILE))).toThrowError(/déjà ouvert/);
  });

  it('partage la connexion entre deux copies du module : trois graphes Turbopack, une seule base', async () => {
    // Le serveur de production charge ce module trois fois (amorçage, pages,
    // routes). Une copie neuve doit retrouver la connexion déjà ouverte.
    vi.resetModules();
    const copie = await import('@/journal/db');

    expect(copie.journal()).toBe(db);
    expect(() => copie.openJournal(join(dataDir(), JOURNAL_FILE))).toThrowError(/déjà ouvert/);
  });

  it('refuse une base écrite par une version plus récente du schéma', () => {
    closeJournal();
    const autre = join(dataDir(), JOURNAL_FILE);
    const future = new DatabaseSync(autre);
    future.exec(DDL);
    future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    future.close();

    expect(() => openJournal(autre)).toThrowError(new RegExp(`version ${SCHEMA_VERSION + 1}`));
    // La base n'est pas restée ouverte : le journal peut être rouvert ailleurs.
    db = openJournal(path);
  });

  it('échoue avec un message explicite quand le répertoire nʼexiste pas', () => {
    closeJournal();
    const absent = join(tmpdir(), `cv-journal-inexistant-${ulid()}`);

    expect(() => openJournal(join(absent, JOURNAL_FILE))).toThrowError(/DATA_DIR/);
    expect(() => openJournal(join(absent, JOURNAL_FILE))).toThrowError(absent);
    db = openJournal(path);
  });

  it('refuse une base existante devenue en lecture seule — au démarrage, pas à la première visite', () => {
    // Attribut lecture seule sur `usage.db` (ce que `chmod 444` pose aussi sous
    // Windows) : SQLite l'ouvre en lecture seule, et la sonde d'écriture de
    // l'ouverture doit le dire, avec le mot que l'exploitant attend.
    closeJournal();
    chmodSync(path, 0o444);
    try {
      expect(() => openJournal(path)).toThrowError(/inscriptible/);
      expect(() => openJournal(path)).toThrowError(/DATA_DIR/);
    } finally {
      chmodSync(path, 0o644);
    }
    db = openJournal(path);
  });

  it('refuse une base non vide sans version de schéma : ce fichier nʼest pas le nôtre', () => {
    closeJournal();
    const etrangere = new DatabaseSync(path);
    etrangere.exec('PRAGMA user_version = 0; CREATE TABLE IF NOT EXISTS autre (x TEXT);');
    etrangere.close();

    expect(() => openJournal(path)).toThrowError(/pas été créé par ce site/);

    // Nettoyage : une base neuve pour l'`afterEach`.
    rmSync(path, {force: true});
    db = openJournal(path);
  });

  it('échoue avec un message explicite quand le répertoire est un fichier', () => {
    closeJournal();
    // `path` est le fichier `usage.db` déjà créé : un répertoire de ce nom n'existe pas.
    expect(() => openJournal(join(path, JOURNAL_FILE))).toThrowError(/DATA_DIR/);
    db = openJournal(path);
  });
});

describe('ce que le module ne peut pas faire', () => {
  const sources = readdirSync(JOURNAL_SOURCES)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(join(JOURNAL_SOURCES, name), 'utf8')] as const);

  it('a bien des sources à contrôler', () => {
    expect(sources.map(([name]) => name).sort()).toEqual(['db.ts', 'index.ts', 'schema.ts']);
  });

  it.each(sources)('%s ne contient ni DELETE, ni DROP, ni TRUNCATE, ni REPLACE', (_name, source) => {
    // `REPLACE INTO` / `INSERT OR REPLACE` supprime la ligne en conflit avant de
    // réinsérer : une suppression déguisée, au sens d'AD-7.
    expect(source).not.toMatch(/\b(DELETE|DROP|TRUNCATE|REPLACE)\b/i);
  });

  it.each(sources)('%s ne modifie que session.last_seen_at', (_name, source) => {
    // Tout `UPDATE` doit être `UPDATE session SET last_seen_at = … WHERE …`,
    // avec une seule affectation dans le `SET`. Le nombre d'occurrences du mot
    // et le nombre d'instructions reconnues doivent coïncider : une forme
    // inattendue ne passe pas inaperçue.
    const occurrences = source.match(/\bUPDATE\b/gi) ?? [];
    const instructions = [...source.matchAll(/\bUPDATE\s+(\w+)\s+SET\s+([^']*?)\s+WHERE\b/gi)];

    expect(instructions.length).toBe(occurrences.length);
    for (const [, table, affectations] of instructions) {
      expect(table).toBe('session');
      const colonnes = affectations!.split('=');
      expect(colonnes.length, `une seule affectation : ${affectations}`).toBe(2);
      expect(colonnes[0]!.trim()).toBe('last_seen_at');
    }
  });
});
