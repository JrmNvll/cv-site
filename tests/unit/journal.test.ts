/**
 * AD-6 / AD-7 / AD-14 — le journal : ce que `touchSession()` écrit, ce qu'il
 * refuse d'écrire, ce qu'`addExchange()` insère (story 5 : un échange à coût
 * nul), la séquence réservation → finalisation d'un appel au modèle et le
 * cumul du mois (story 6), et ce que le module ne peut pas faire du tout.
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
  finalizeExchange,
  findExchange,
  findSession,
  findVisitor,
  HERO_EXCHANGES_PER_SESSION,
  monthSpendMicroUsd,
  monthStart,
  PENDING_STALE_MS,
  recentExchanges,
  recordCapRefusal,
  reserveExchange,
  settleStalePending,
  touchSession,
  type AddExchangeInput,
  type FinalizeExchangeInput,
  type ReserveExchangeInput,
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

/** Une réservation qui doit passer : l'identifiant, ou l'échec du test. */
function reserved(input: ReserveExchangeInput): string {
  const outcome = reserveExchange(input);
  if (outcome.capReached) throw new Error(`réservation refusée au plafond (${outcome.spentMicroUsd})`);
  return outcome.id;
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
    const {id} = addExchange(echange({latencyMs: Number.NaN}))!;
    expect(findExchange(id)!.latencyMs).toBe(0);
  });
  it('insère une ligne done, à coût nul, sans jetons, avec ses sources en JSON', () => {
    const entree = echange();

    const {id} = addExchange(entree)!;

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
    const {id} = addExchange(echange({now: undefined}))!;
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
    const premier = addExchange(entree)!;
    const second = addExchange({...entree, sources: [], citationOk: false, now: NOW})!;

    expect(premier.id).not.toBe(second.id);
    expect(count('exchange')).toBe(2);
    expect(findExchange(second.id)).toMatchObject({sources: [], citationOk: false, at: NOW.toISOString()});
  });

  it(`nʼinsère plus au-delà de ${HERO_EXCHANGES_PER_SESSION} échanges hero par session : null, rien écrit`, () => {
    const entree = echange();
    for (let n = 0; n < HERO_EXCHANGES_PER_SESSION; n += 1) {
      expect(addExchange({...entree, now: new Date(NOW.getTime() + n)})).not.toBeNull();
    }
    expect(count('exchange')).toBe(HERO_EXCHANGES_PER_SESSION);

    expect(addExchange({...entree, now: LATER})).toBeNull();

    expect(count('exchange')).toBe(HERO_EXCHANGES_PER_SESSION);
    // Une autre session du même visiteur repart de zéro : la borne est par session.
    const autre = visite({now: LATER});
    touchSession(autre);
    expect(addExchange({...entree, sessionId: autre.sessionId})).not.toBeNull();
  });
});

describe('un appel au modèle : réservation, puis finalisation (story 6)', () => {
  /** Une session ouverte, puis une réservation à y rattacher. */
  function reservation(overrides: Partial<ReserveExchangeInput> = {}): ReserveExchangeInput {
    const session = visite();
    touchSession(session);
    return {
      sessionId: session.sessionId,
      kind: 'chat',
      question: 'Question libre fictive ?',
      reservationMicroUsd: 85_000,
      capMicroUsd: 5_000_000,
      now: NOW,
      ...overrides
    };
  }


  function finalisation(id: string, overrides: Partial<FinalizeExchangeInput> = {}): FinalizeExchangeInput {
    return {
      id,
      status: 'done',
      answer: 'Réponse **fictive** du modèle.',
      sources: ['qa:lic-01', 'cv:profil'],
      citationOk: true,
      usage: {inputTokens: 8000, outputTokens: 400, cacheReadTokens: 7000, cacheCreationTokens: 0},
      costMicroUsd: 53_500,
      latencyMs: 1234.4,
      ...overrides
    };
  }

  it('réserve une ligne pending qui porte la réservation en coût, sans réponse ni compteurs', () => {
    const entree = reservation();

    const id = reserved(entree);

    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBe(NOW.getTime());
    expect(findExchange(id)).toEqual({
      id,
      sessionId: entree.sessionId,
      kind: 'chat',
      status: 'pending',
      question: 'Question libre fictive ?',
      answer: null,
      sources: null,
      citationOk: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costMicroUsd: 85_000,
      latencyMs: null,
      at: NOW.toISOString()
    });
  });

  it('refuse de réserver hero, une question vide, une réservation non entière, une session absente', () => {
    expect(() => reserveExchange(reservation({kind: 'hero' as 'chat'}))).toThrowError(/hero/);
    expect(() => reserveExchange(reservation({question: ' '}))).toThrowError(/vide/);
    expect(() => reserveExchange(reservation({reservationMicroUsd: 12.5}))).toThrowError(/entier/);
    expect(() => reserveExchange(reservation({reservationMicroUsd: -1}))).toThrowError(/entier/);
    expect(() => reserveExchange(reservation({capMicroUsd: 0.5}))).toThrowError(/entier/);
    expect(() => reserveExchange(reservation({sessionId: 'pas-un-ulid'}))).toThrowError(TypeError);
    expect(() => reserveExchange(reservation({sessionId: ulid()}))).toThrowError(/FOREIGN KEY/);
    expect(count('exchange')).toBe(0);
  });

  it('finalise en done avec les quatre compteurs, le coût réel, les sources et la latence', () => {
    const id = reserved(reservation());

    finalizeExchange(finalisation(id));

    expect(findExchange(id)).toMatchObject({
      status: 'done',
      answer: 'Réponse **fictive** du modèle.',
      sources: ['qa:lic-01', 'cv:profil'],
      citationOk: true,
      inputTokens: 8000,
      outputTokens: 400,
      cacheReadTokens: 7000,
      cacheCreationTokens: 0,
      costMicroUsd: 53_500,
      latencyMs: 1234,
      // Ce qui a été réservé ne bouge pas : question et instant sont ceux de la réservation.
      question: 'Question libre fictive ?',
      at: NOW.toISOString()
    });
  });

  it('finalise en model_error avec le texte partiel, sans sources ni contrôle, la réservation en coût', () => {
    const id = reserved(reservation());

    finalizeExchange(
      finalisation(id, {
        status: 'model_error',
        answer: 'Début de rép',
        sources: [],
        citationOk: null,
        usage: null,
        costMicroUsd: 85_000
      })
    );

    expect(findExchange(id)).toMatchObject({
      status: 'model_error',
      answer: 'Début de rép',
      sources: [],
      citationOk: null,
      inputTokens: null,
      outputTokens: null,
      costMicroUsd: 85_000
    });
  });

  it('refuse une seconde finalisation : une ligne finalisée nʼest plus pending', () => {
    const id = reserved(reservation());
    finalizeExchange(finalisation(id));

    expect(() => finalizeExchange(finalisation(id, {costMicroUsd: 1}))).toThrowError(/pending/);

    // Le coût réel de la première finalisation est intact.
    expect(findExchange(id)!.costMicroUsd).toBe(53_500);
  });

  it('refuse de finaliser un échange inconnu, ou un hero déjà répondu', () => {
    expect(() => finalizeExchange(finalisation(ulid()))).toThrowError(/pending/);
    const session = visite();
    touchSession(session);
    const hero = addExchange({
      sessionId: session.sessionId,
      kind: 'hero',
      question: 'Q ?',
      answer: 'R.',
      sources: ['qa:lic-01'],
      citationOk: true,
      latencyMs: 1
    })!;
    expect(() => finalizeExchange(finalisation(hero.id))).toThrowError(/pending/);
    expect(findExchange(hero.id)!.costMicroUsd).toBe(0);
  });

  it('refuse une finalisation mal formée : statut hors liste, coût ou compteur non entier', () => {
    const id = reserved(reservation());
    expect(() => finalizeExchange(finalisation(id, {status: 'pending' as 'done'}))).toThrowError(/statut/);
    expect(() => finalizeExchange(finalisation(id, {costMicroUsd: 0.5}))).toThrowError(/entier/);
    expect(() =>
      finalizeExchange(
        finalisation(id, {usage: {inputTokens: -1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0}})
      )
    ).toThrowError(/usage\.inputTokens/);
    expect(findExchange(id)!.status).toBe('pending');
  });

  it('refuse au plafond dans sa propre transaction : deux réservations juste en dessous, la seconde est refusée', () => {
    // Le plafond se décide sous le verrou d'écriture, somme et insertion
    // ensemble : la première réservation compte pour la seconde, quel que soit
    // le code appelant. Ici, 5 USD de plafond, deux réservations de 3 USD.
    const entree = reservation({reservationMicroUsd: 3_000_000, capMicroUsd: 5_000_000});

    const premiere = reserveExchange(entree);
    const seconde = reserveExchange({...entree, now: LATER});

    expect(premiere.capReached).toBeUndefined();
    expect(seconde).toEqual({capReached: true, spentMicroUsd: 3_000_000});
    // Rien n'a été écrit pour la seconde : une seule ligne, la première.
    expect(count('exchange')).toBe(1);
    // Exactement au plafond, ça passe ; un micro-USD de plus, non.
    expect(reserveExchange({...entree, reservationMicroUsd: 2_000_000, now: LATER}).capReached).toBeUndefined();
    expect(reserveExchange({...entree, reservationMicroUsd: 1, now: LATER})).toEqual({
      capReached: true,
      spentMicroUsd: 5_000_000
    });
    expect(count('exchange')).toBe(2);
  });

  it('journalise un refus au plafond : cap_reached, coût nul, question conservée, rien dʼautre', () => {
    const session = visite();
    touchSession(session);

    const {id} = recordCapRefusal({
      sessionId: session.sessionId,
      kind: 'chat',
      question: 'Question refusée au plafond ?',
      now: LATER
    });

    expect(findExchange(id)).toEqual({
      id,
      sessionId: session.sessionId,
      kind: 'chat',
      status: 'cap_reached',
      question: 'Question refusée au plafond ?',
      answer: null,
      sources: null,
      citationOk: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costMicroUsd: 0,
      latencyMs: null,
      at: LATER.toISOString()
    });
    expect(() => recordCapRefusal({sessionId: session.sessionId, kind: 'hero' as 'chat', question: 'Q'})).toThrowError(/hero/);
    expect(() => recordCapRefusal({sessionId: session.sessionId, kind: 'chat', question: ' '})).toThrowError(/vide/);
  });
});

describe('le cumul du mois (AD-6)', () => {
  it('commence au premier du mois, à minuit UTC', () => {
    expect(monthStart(new Date('2026-09-15T23:59:59.999Z'))).toBe('2026-09-01T00:00:00.000Z');
    expect(monthStart(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
    // Un instant local du 30 septembre au soir peut déjà être le 1er octobre en UTC : UTC fait foi.
    expect(monthStart(new Date('2026-10-01T00:30:00.000Z'))).toBe('2026-10-01T00:00:00.000Z');
  });

  it('somme les coûts du mois, réservations pending comprises, et ignore le mois précédent', () => {
    const session = visite();
    touchSession(session);
    const base = {sessionId: session.sessionId, kind: 'chat' as const, question: 'Q ?', capMicroUsd: 5_000_000};
    // Le mois précédent : ignoré, quel que soit le montant.
    reserveExchange({...base, reservationMicroUsd: 4_000_000, now: new Date('2026-08-31T23:59:59.999Z')});
    // Ce mois : une réservation en cours, un échange finalisé, une erreur, un refus, un hero.
    reserveExchange({...base, reservationMicroUsd: 85_000, now: new Date('2026-09-01T00:00:00.000Z')});
    const done = reserved({...base, reservationMicroUsd: 85_000, now: NOW});
    finalizeExchange({
      id: done,
      status: 'done',
      answer: 'R.',
      sources: [],
      citationOk: true,
      usage: {inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0},
      costMicroUsd: 30,
      latencyMs: 1
    });
    const failed = reserved({...base, reservationMicroUsd: 85_000, now: NOW});
    finalizeExchange({
      id: failed,
      status: 'model_error',
      answer: '',
      sources: [],
      citationOk: null,
      usage: null,
      costMicroUsd: 85_000,
      latencyMs: 1
    });
    recordCapRefusal({...base, now: NOW});
    addExchange({...base, kind: 'hero', answer: 'R.', sources: [], citationOk: true, latencyMs: 1, now: NOW});

    expect(monthSpendMicroUsd(NOW)).toBe(85_000 + 30 + 85_000);
    // Le mois suivant repart de zéro — sans rien effacer.
    expect(monthSpendMicroUsd(new Date('2026-10-02T00:00:00.000Z'))).toBe(0);
    expect(count('exchange')).toBe(6);
  });

  it('vaut zéro sur une base vide', () => {
    expect(monthSpendMicroUsd(NOW)).toBe(0);
  });
});

describe('les réservations orphelines (arrêt brutal entre réservation et finalisation)', () => {
  it('règle en model_error, à la réservation, toute ligne pending plus vieille que dix minutes — et rien dʼautre', () => {
    const session = visite();
    touchSession(session);
    const base = {sessionId: session.sessionId, kind: 'chat' as const, question: 'Q ?', capMicroUsd: 5_000_000};
    const vieille = reserveExchange({...base, reservationMicroUsd: 85_000, now: new Date(NOW.getTime() - PENDING_STALE_MS - 1)});
    const limite = reserveExchange({...base, reservationMicroUsd: 70_000, now: new Date(NOW.getTime() - PENDING_STALE_MS)});
    const recente = reserveExchange({...base, reservationMicroUsd: 60_000, now: new Date(NOW.getTime() - PENDING_STALE_MS + 1)});
    const finalisee = reserveExchange({...base, reservationMicroUsd: 50_000, now: new Date(NOW.getTime() - PENDING_STALE_MS - 1)});
    if (vieille.capReached || limite.capReached || recente.capReached || finalisee.capReached) throw new Error('plafond');
    finalizeExchange({id: finalisee.id, status: 'done', answer: 'R.', sources: [], citationOk: true, usage: null, costMicroUsd: 10, latencyMs: 1});
    expect(PENDING_STALE_MS).toBe(10 * 60_000);

    expect(settleStalePending(NOW)).toBe(2);

    // La vieille et celle pile à la limite : réglées, à la réservation, sans rien d'autre.
    for (const [id, reservation] of [[vieille.id, 85_000], [limite.id, 70_000]] as const) {
      expect(findExchange(id)).toMatchObject({
        status: 'model_error',
        answer: '',
        sources: [],
        citationOk: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        costMicroUsd: reservation,
        latencyMs: 0,
        question: 'Q ?'
      });
    }
    // La récente attend encore ; la finalisée n'a pas bougé.
    expect(findExchange(recente.id)!.status).toBe('pending');
    expect(findExchange(finalisee.id)).toMatchObject({status: 'done', costMicroUsd: 10});
    // Le cumul n'a pas changé : une réservation réglée à la réservation coûte ce qu'elle coûtait.
    expect(monthSpendMicroUsd(NOW)).toBe(85_000 + 70_000 + 60_000 + 10);
    // Un second passage ne trouve plus rien.
    expect(settleStalePending(NOW)).toBe(0);
    expect(() => settleStalePending(new Date('pas une date'))).toThrowError(TypeError);
  });

  it('est joué à lʼouverture par ensureJournal, et le dit une fois, avec le nombre', async () => {
    const session = visite();
    touchSession(session);
    reserveExchange({sessionId: session.sessionId, kind: 'chat', question: 'Q ?', reservationMicroUsd: 1, capMicroUsd: 5, now: new Date(Date.now() - PENDING_STALE_MS - 1000)});
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {ensureJournal} = await import('@/journal');

    ensureJournal();

    const lignes = avertit.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lignes).toEqual([expect.objectContaining({level: 'warn', event: 'journal.pending_settled', count: 1})]);
    // Rien à régler : rien à dire.
    ensureJournal();
    expect(avertit).toHaveBeenCalledTimes(1);
  });
});

describe('lʼhistorique dʼune session (AD-3)', () => {
  it('rend les derniers échanges done, toute sorte confondue, du plus ancien au plus récent', () => {
    const session = visite();
    touchSession(session);
    const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
    const base = {sessionId: session.sessionId, kind: 'chat' as const, capMicroUsd: 5_000_000};
    addExchange({sessionId: session.sessionId, kind: 'hero', question: 'Q1', answer: 'R1', sources: [], citationOk: true, latencyMs: 1, now: at(1)});
    const second = reserved({...base, question: 'Q2', reservationMicroUsd: 1, now: at(2)});
    finalizeExchange({id: second, status: 'done', answer: 'R2', sources: [], citationOk: true, usage: null, costMicroUsd: 1, latencyMs: 1});
    // Une erreur, une réservation en cours et un refus n'ont rien à reprendre.
    const third = reserved({...base, question: 'Q3', reservationMicroUsd: 1, now: at(3)});
    finalizeExchange({id: third, status: 'model_error', answer: 'partiel', sources: [], citationOk: null, usage: null, costMicroUsd: 1, latencyMs: 1});
    reserveExchange({...base, question: 'Q4', reservationMicroUsd: 1, now: at(4)});
    recordCapRefusal({sessionId: session.sessionId, kind: 'chat', question: 'Q5', now: at(5)});
    const sixth = reserved({...base, question: 'Q6', reservationMicroUsd: 1, now: at(6)});
    finalizeExchange({id: sixth, status: 'done', answer: 'R6', sources: [], citationOk: true, usage: null, costMicroUsd: 1, latencyMs: 1});
    // Une autre session : invisible.
    const autre = visite();
    touchSession(autre);
    addExchange({sessionId: autre.sessionId, kind: 'hero', question: 'Qx', answer: 'Rx', sources: [], citationOk: true, latencyMs: 1, now: at(7)});

    const tous = recentExchanges(session.sessionId, 10);
    expect(tous.map((exchange) => [exchange.kind, exchange.question, exchange.answer])).toEqual([
      ['hero', 'Q1', 'R1'],
      ['chat', 'Q2', 'R2'],
      ['chat', 'Q6', 'R6']
    ]);
    // La limite garde les plus récents, toujours rendus du plus ancien au plus récent.
    expect(recentExchanges(session.sessionId, 2).map((exchange) => exchange.question)).toEqual(['Q2', 'Q6']);
    expect(recentExchanges(session.sessionId, 0)).toEqual([]);
    expect(recentExchanges(ulid(), 6)).toEqual([]);
    expect(() => recentExchanges('pas-un-ulid', 6)).toThrowError(TypeError);
    expect(() => recentExchanges(session.sessionId, 1.5)).toThrowError(TypeError);
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

  it.each([
    [
      1,
      // Le DDL de la version 1 : `exchange.kind` sans `hero`, `status` sans `cap_reached`.
      DDL.replace("CHECK (kind IN ('chat', 'match', 'hero'))", "CHECK (kind IN ('chat', 'match'))").replace(
        "CHECK (status IN ('pending', 'done', 'model_error', 'cap_reached'))",
        "CHECK (status IN ('pending', 'done', 'model_error'))"
      )
    ],
    [
      2,
      // Le DDL de la version 2 : `status` sans `cap_reached`.
      DDL.replace(
        "CHECK (status IN ('pending', 'done', 'model_error', 'cap_reached'))",
        "CHECK (status IN ('pending', 'done', 'model_error'))"
      )
    ]
  ])('refuse une base en version %i — schéma changé avant la mise en ligne, à recréer', (version, ddl) => {
    // Rejouer le DDL courant n'y changerait rien (`IF NOT EXISTS`), et aucune
    // migration n'existe : la base d'avant la mise en ligne se recrée, elle ne
    // se convertit pas.
    expect(ddl).not.toBe(DDL);
    closeJournal();
    const ancienne = join(dataDir(), JOURNAL_FILE);
    const vieille = new DatabaseSync(ancienne);
    vieille.exec(ddl);
    vieille.exec(`PRAGMA user_version = ${version}`);
    vieille.close();

    expect(() => openJournal(ancienne)).toThrowError(new RegExp(`version ${version}`));
    expect(() => openJournal(ancienne)).toThrowError(/recréer usage\.db/);
    expect(() => openJournal(ancienne)).toThrowError(/DATA_DIR/);
    // Rien n'a été tamponné ni modifié : la base reste à sa version.
    const relue = new DatabaseSync(ancienne, {readOnly: true});
    expect((relue.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(version);
    relue.close();
    db = openJournal(path);
  });

  it('est en version 3 : lʼéchange admet la sorte hero et le statut cap_reached', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(DDL).toContain("CHECK (kind IN ('chat', 'match', 'hero'))");
    expect(DDL).toContain("CHECK (status IN ('pending', 'done', 'model_error', 'cap_reached'))");
    expect([...EXCHANGE_STATUSES].sort()).toEqual(['cap_reached', 'done', 'model_error', 'pending']);
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

  /** La liste fermée d'AD-7 : ce qu'une finalisation peut poser sur un `exchange`. */
  const FINALISATION = [
    'status',
    'answer',
    'sources',
    'citation_ok',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'cost_micro_usd',
    'latency_ms'
  ];

  it.each(sources)('%s ne modifie que session.last_seen_at et la finalisation dʼun exchange pending', (_name, source) => {
    // Tout `UPDATE` doit être l'une des deux formes d'AD-7, et le test refuse
    // tout le reste :
    //  - `UPDATE session SET last_seen_at = … WHERE id = ?` — **une seule**
    //    affectation, et c'est `last_seen_at` ; `SET last_seen_at = ?, ip = ?`
    //    est refusé ;
    //  - `UPDATE exchange SET <colonnes> WHERE id = ? AND status = 'pending'`
    //    — chaque colonne affectée dans la liste fermée de la finalisation,
    //    aucune deux fois, et **exactement** cette clause `WHERE` : ni une
    //    autre condition, ni une ligne qui ne soit pas `pending`.
    // Le nombre d'occurrences du mot et le nombre d'instructions reconnues
    // doivent coïncider : une forme inattendue ne passe pas inaperçue.
    const occurrences = source.match(/\bUPDATE\b/gi) ?? [];
    // La clause `WHERE` s'arrête au guillemet ou à l'accent grave qui ferme la
    // chaîne SQL — suivi d'une parenthèse ou d'un retour à la ligne.
    const instructions = [
      ...source.matchAll(/\bUPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?)(?=\s*['`]\s*(?:\)|\n))/gi)
    ];
    const normalise = (clause: string) => clause.replace(/\s+/g, ' ').trim();
    // Une parenthèse ne doit pas pouvoir cacher une virgule (`max(a, b)`) :
    // retirées avant de découper la liste des affectations.
    const colonnesDe = (affectations: string) =>
      affectations
        .replace(/\([^)]*\)/g, '')
        .split(',')
        .map((item) => item.split('=')[0]!.trim());

    expect(instructions.length).toBe(occurrences.length);
    for (const [, table, affectations, condition] of instructions) {
      const colonnes = colonnesDe(affectations!);
      if (table === 'session') {
        expect(colonnes).toEqual(['last_seen_at']);
        expect(normalise(condition!)).toBe('id = ?');
        continue;
      }
      expect(table).toBe('exchange');
      for (const colonne of colonnes) {
        expect(FINALISATION, `colonne hors liste fermée : ${colonne}`).toContain(colonne);
      }
      expect(new Set(colonnes).size).toBe(colonnes.length);
      expect(normalise(condition!)).toBe("id = ? AND status = 'pending'");
    }
  });

  it('le garde refuse bien ce quʼil dit refuser', () => {
    // Sonde sur des sources fictives : deux affectations sur `session`, une
    // colonne hors liste, une autre clause `WHERE` — chacune doit être vue.
    const analyse = (sql: string) =>
      [...sql.matchAll(/\bUPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?)(?=\s*['`]\s*(?:\)|\n))/gi)].map(
        ([, table, affectations, condition]) => ({
          table,
          colonnes: affectations!.replace(/\([^)]*\)/g, '').split(',').map((item) => item.split('=')[0]!.trim()),
          condition: condition!.replace(/\s+/g, ' ').trim()
        })
      );
    expect(analyse("db.prepare('UPDATE session SET last_seen_at = ?, ip = ? WHERE id = ?').run(")).toEqual([
      {table: 'session', colonnes: ['last_seen_at', 'ip'], condition: 'id = ?'}
    ]);
    expect(analyse("db.prepare(`UPDATE exchange SET question = ? WHERE id = ?`\n)")).toEqual([
      {table: 'exchange', colonnes: ['question'], condition: 'id = ?'}
    ]);
    expect(analyse("db.prepare(`UPDATE exchange SET status = ? WHERE status = 'pending' AND at < ?`\n)")).toEqual([
      {table: 'exchange', colonnes: ['status'], condition: "status = 'pending' AND at < ?"}
    ]);
  });
});
