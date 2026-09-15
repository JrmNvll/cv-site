/**
 * AD-7 / AD-14 — le journal : ce que `touchSession()` écrit, ce qu'il refuse
 * d'écrire, ce qu'`addExchange()` insère (story 5 : un échange à coût nul), et
 * ce que le module ne peut pas faire du tout.
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
import {
  addExchange,
  EXCHANGE_KINDS,
  EXCHANGE_STATUSES,
  findExchange,
  findSession,
  findVisitor,
  touchSession,
  type AddExchangeInput,
  type TouchSessionInput
} from '@/journal';
import {isUlid, ulid, ulidTime} from '@/lib/ulid';

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
  it('rend undefined pour un visiteur, une session ou un échange inconnus', () => {
    expect(findVisitor(ulid())).toBeUndefined();
    expect(findSession(ulid())).toBeUndefined();
    expect(findExchange(ulid())).toBeUndefined();
  });
});

describe('échange servi sans appel au modèle (story 5)', () => {
  /** Une session ouverte, puis un échange `hero` à y rattacher. */
  function echange(overrides: Partial<AddExchangeInput> = {}): AddExchangeInput {
    const session = visite();
    touchSession(session);
    return {
      sessionId: session.sessionId,
      kind: 'hero',
      question: 'Question fictive du corpus ?',
      answer: 'Corps **fictif**, tel quel.',
      sources: ['qa:lic-01'],
      citationOk: true,
      latencyMs: 3.6,
      now: LATER,
      ...overrides
    };
  }

  it('refuse ce qui nʼest pas une mesure ni un texte', () => {
    expect(() => addExchange(echange({question: '  '}))).toThrowError(/vides/);
    expect(() => addExchange(echange({answer: ''}))).toThrowError(/vides/);
    expect(() => addExchange(echange({now: new Date('pas une date')}))).toThrowError(/date valide/);
    // Une latence qui n'est pas un nombre fini vaut zéro, pas NULL ni Infinity.
    const {id} = addExchange(echange({latencyMs: Number.NaN}));
    expect(findExchange(id)!.latencyMs).toBe(0);
  });
  it('insère une ligne done, à coût nul, sans jetons, avec ses sources en JSON', () => {
    const entree = echange();

    const {id} = addExchange(entree);

    expect(isUlid(id)).toBe(true);
    // L'identifiant est daté de l'instant de l'échange, comme les autres.
    expect(ulidTime(id)).toBe(LATER.getTime());
    expect(count('exchange')).toBe(1);
    expect(findExchange(id)).toEqual({
      id,
      sessionId: entree.sessionId,
      kind: 'hero',
      status: 'done',
      question: 'Question fictive du corpus ?',
      answer: 'Corps **fictif**, tel quel.',
      sources: ['qa:lic-01'],
      citationOk: true,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costMicroUsd: 0,
      latencyMs: 4,
      at: LATER.toISOString()
    });
    // En base, `sources` est un tableau JSON de chaînes (AD-7), `citation_ok` un entier.
    const brut = db
      .prepare('SELECT sources, citation_ok, cost_micro_usd FROM exchange WHERE id = ?')
      .get(id) as {sources: string; citation_ok: number; cost_micro_usd: number};
    expect(JSON.parse(brut.sources)).toEqual(['qa:lic-01']);
    expect(brut.citation_ok).toBe(1);
    expect(brut.cost_micro_usd).toBe(0);
  });

  it('horodate à lʼinstant courant par défaut', () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATER);
    const {id} = addExchange(echange({now: undefined}));
    vi.useRealTimers();

    expect(findExchange(id)!.at).toBe(LATER.toISOString());
  });

  it('refuse un échange sans session : la clé étrangère est appliquée par la base', () => {
    expect(() => addExchange(echange({sessionId: ulid()}))).toThrowError(/FOREIGN KEY/);
    expect(count('exchange')).toBe(0);
  });

  it('refuse un identifiant de session qui nʼest pas un ULID, sans rien écrire', () => {
    expect(() => addExchange(echange({sessionId: 'pas-un-ulid'}))).toThrowError(TypeError);
    expect(count('exchange')).toBe(0);
  });

  it('nʼadmet que les trois sortes du schéma : chat, match, hero — et nʼinsère déjà répondu que hero', () => {
    expect([...EXCHANGE_KINDS].sort()).toEqual(['chat', 'hero', 'match']);
    expect(() => addExchange(echange({kind: 'autre' as 'hero'}))).toThrowError(/seul hero/);
    // Un échange `chat` inséré `done` sans jetons ferait passer un appel au
    // modèle pour gratuit : c'est la séquence d'AD-6 qui l'écrira (story 6).
    expect(() => addExchange(echange({kind: 'chat' as 'hero'}))).toThrowError(/seul hero/);
    // Et la base elle-même refuse une sorte inconnue : la contrainte est en base, pas seulement en code.
    const session = visite();
    touchSession(session);
    expect(() =>
      db
        .prepare(
          `INSERT INTO exchange (id, session_id, kind, status, question, at)
           VALUES (?, ?, 'autre', 'done', 'q', ?)`
        )
        .run(ulid(), session.sessionId, NOW.toISOString())
    ).toThrowError(/CHECK/);
    expect(count('exchange')).toBe(0);
  });

  it('accepte plusieurs échanges sur une même session, et une réponse sans citation', () => {
    const entree = echange();
    const premier = addExchange(entree);
    const second = addExchange({...entree, sources: [], citationOk: false, now: NOW});

    expect(premier.id).not.toBe(second.id);
    expect(count('exchange')).toBe(2);
    expect(findExchange(second.id)).toMatchObject({sources: [], citationOk: false, at: NOW.toISOString()});
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

  it('refuse une base en version 1 — schéma changé avant la mise en ligne, à recréer', () => {
    // Le DDL de la version 1 : `exchange.kind` sans `hero`. Rejouer le DDL
    // courant n'y changerait rien (`IF NOT EXISTS`), et aucune migration
    // n'existe : la base d'avant la mise en ligne se recrée, elle ne se convertit pas.
    closeJournal();
    const ancienne = join(dataDir(), JOURNAL_FILE);
    const v1 = new DatabaseSync(ancienne);
    v1.exec(DDL.replace("CHECK (kind IN ('chat', 'match', 'hero'))", "CHECK (kind IN ('chat', 'match'))"));
    v1.exec('PRAGMA user_version = 1');
    v1.close();

    expect(() => openJournal(ancienne)).toThrowError(/version 1/);
    expect(() => openJournal(ancienne)).toThrowError(/recréer usage\.db/);
    expect(() => openJournal(ancienne)).toThrowError(/DATA_DIR/);
    // Rien n'a été tamponné ni modifié : la base reste en version 1.
    const relue = new DatabaseSync(ancienne, {readOnly: true});
    expect((relue.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(1);
    relue.close();
    db = openJournal(path);
  });

  it('est en version 2 : lʼéchange admet la sorte hero', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(DDL).toContain("CHECK (kind IN ('chat', 'match', 'hero'))");
  });

  it('dérive les CHECK du DDL des listes closes du code : une seule vérité', () => {
    const cite = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');
    expect(DDL).toContain(`CHECK (kind IN (${cite(EXCHANGE_KINDS)}))`);
    expect(DDL).toContain(`CHECK (status IN (${cite(EXCHANGE_STATUSES)}))`);
  });

  it('refuse une version de schéma négative : ce nʼest pas une base à nous', () => {
    closeJournal();
    const etrange = new DatabaseSync(path);
    etrange.exec('PRAGMA user_version = -1');
    etrange.close();
    expect(() => openJournal(path)).toThrowError(/version -1/);
    rmSync(path, {force: true});
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
