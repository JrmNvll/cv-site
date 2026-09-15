/**
 * Couche `journal` — frontière.
 *
 * Responsabilité : seul propriétaire de `usage.db` (`node:sqlite`, fichier dans
 * `DATA_DIR`) — visiteurs, sessions, échanges, cumul de dépense. Écritures en
 * insertion, plus la liste fermée de colonnes modifiables d'AD-7 ; ici, seule
 * `session.last_seen_at` bouge. Aucune suppression, aucune purge, aucune table
 * d'agrégat.
 *
 * Dépendances autorisées : `src/env.ts`, `src/lib/`, `node:sqlite`, ses propres
 * types. Interdites : `content`, `knowledge`, `agent`, `app`. Le journal ne
 * connaît ni HTTP ni Next : visiteur, session, adresse, navigateur, provenance
 * et langue lui sont **passés** — c'est ce qui le rend testable sur une base
 * temporaire sans monter Next, et ce qui garantit une seule lecture des cookies
 * (AD-14) et une seule source pour l'adresse (AD-15).
 *
 * **Surface publique.** `touchSession()` est le seul point d'entrée qui crée ou
 * prolonge une session ; `addExchange()` le seul qui insère un échange —
 * finalisé d'emblée, pour les réponses servies sans appel au modèle ; la
 * réservation puis la finalisation d'un échange qui appelle le modèle (AD-6)
 * viendront avec la passerelle. `findVisitor()`, `findSession()` et
 * `findExchange()` sont la lecture minimale dont les tests et l'admin à venir
 * ont besoin ; `ensureJournal()` ouvre la base à l'amorçage sans en rendre la
 * connexion — l'application n'a pas à la tenir. Seuls les tests passent par
 * `./db` pour ouvrir une base temporaire.
 */
import type {DatabaseSync} from 'node:sqlite';
import {isUlid, ulid} from '@/lib/ulid';
import {journal} from './db';

/**
 * Ouvre `DATA_DIR/usage.db` — pour l'amorçage (`src/lib/startup.ts`), qui
 * veut qu'un `DATA_DIR` inaccessible arrête le processus avant la première
 * requête, et n'a rien à faire de la connexion elle-même.
 */
export function ensureJournal(): void {
  journal();
}

/**
 * Les sessions déjà signalées en `mismatch`, pour n'avertir qu'une fois par
 * session et par processus : un cookie forgé présenté en boucle inonderait
 * sinon le journal applicatif à chaque requête. Borné, comme tout ce qui
 * grandit en mémoire.
 */
const reportedMismatches = new Set<string>();
const MISMATCH_REPORTS_MAX = 256;

/** Ce que l'appelant a extrait de la requête — jamais la requête elle-même. */
export type TouchSessionInput = {
  /** `cv_visitor`, un ULID validé par l'appelant. */
  readonly visitorId: string;
  /** La partie avant le point de `cv_session`, un ULID validé par l'appelant. */
  readonly sessionId: string;
  /** Ce que `clientIp(headers)` a rendu : une adresse, `'dev'` ou `'unknown'`. */
  readonly ip: string;
  /** En-tête `User-Agent`, ou `null` s'il manque. */
  readonly userAgent: string | null;
  /** En-tête `Referer`, ou `null` s'il manque — la provenance d'une visite. */
  readonly referer: string | null;
  /** La langue courante du document. */
  readonly lang: string;
  /** L'instant de la visite ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/**
 * `created` : la session n'existait pas, elle vient d'être insérée (le visiteur
 * aussi, s'il était inconnu). `prolonged` : elle existait, `last_seen_at` avance.
 * `mismatch` : elle existe mais appartient à un autre visiteur — rien n'est écrit.
 */
export type TouchOutcome = 'created' | 'prolonged' | 'mismatch';

export type TouchSessionResult = {
  readonly outcome: TouchOutcome;
  /** Vrai seulement quand cet appel a inséré le visiteur. */
  readonly visitorCreated: boolean;
};

export type Visitor = {
  readonly id: string;
  /** Attribué par l'admin. */
  readonly name: string | null;
  readonly note: string | null;
  /** ISO 8601 UTC. */
  readonly firstSeen: string;
};

export type Session = {
  readonly id: string;
  readonly visitorId: string;
  readonly ip: string;
  /** Attribué par l'admin, à toutes les sessions qui portent la même adresse. */
  readonly ipLabel: string | null;
  readonly userAgent: string | null;
  readonly referer: string | null;
  readonly lang: string;
  /** ISO 8601 UTC. */
  readonly startedAt: string;
  /** ISO 8601 UTC. */
  readonly lastSeenAt: string;
};

/**
 * Une transaction `IMMEDIATE` : le verrou d'écriture est pris dès le début,
 * pas au premier `INSERT`, donc deux requêtes simultanées (document + route)
 * se sérialisent proprement — la seconde attend (`busy_timeout`) et relit un
 * état déjà commis.
 */
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // SQLite peut avoir déjà annulé la transaction lui-même (`SQLITE_FULL`,
    // erreur d'E/S) : un `ROLLBACK` qui échoue alors masquerait l'erreur
    // d'origine, la seule qui dise ce qui s'est passé.
    try {
      db.exec('ROLLBACK');
    } catch {
      // déjà annulée
    }
    throw error;
  }
}

/**
 * Crée ou prolonge une session — le **seul** point d'entrée (AD-7, AD-14).
 *
 * En une transaction : si la session est connue et appartient à ce visiteur,
 * `last_seen_at` avance (jamais ne recule : deux requêtes arrivées dans le
 * désordre ne le font pas reculer) et rien d'autre ne change — provenance,
 * navigateur et adresse sont ceux de la **première** apparition. Si elle est
 * inconnue, elle est insérée, précédée du visiteur s'il l'est aussi : un
 * identifiant jamais vu — cookie effacé, base neuve, ou ULID choisi — est une
 * première visite, exactement comme le proxy le traite. Si elle appartient à
 * un autre visiteur, rien n'est écrit et l'avertissement est journalisé.
 *
 * Les identifiants doivent être des ULID : l'appelant les a validés (`isUlid`)
 * avant d'arriver ici, et le journal le revérifie plutôt que d'écrire n'importe
 * quelle chaîne venue d'un cookie.
 */
export function touchSession(input: TouchSessionInput): TouchSessionResult {
  const {visitorId, sessionId} = input;
  if (!isUlid(visitorId) || !isUlid(sessionId)) {
    throw new TypeError('touchSession : visitorId et sessionId doivent être des ULID validés');
  }
  const now = (input.now ?? new Date()).toISOString();
  const db = journal();

  return transaction(db, () => {
    const existing = db.prepare('SELECT visitor_id FROM session WHERE id = ?').get(sessionId) as
      | {visitor_id: string}
      | undefined;

    if (existing !== undefined) {
      if (existing.visitor_id !== visitorId) {
        if (!reportedMismatches.has(sessionId)) {
          if (reportedMismatches.size >= MISMATCH_REPORTS_MAX) reportedMismatches.clear();
          reportedMismatches.add(sessionId);
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'journal.session_mismatch',
              sessionId,
              visitorId,
              text: "Session présentée avec le cookie d'un autre visiteur : rien n'est écrit."
            })
          );
        }
        return {outcome: 'mismatch', visitorCreated: false};
      }
      db.prepare('UPDATE session SET last_seen_at = max(last_seen_at, ?) WHERE id = ?').run(
        now,
        sessionId
      );
      return {outcome: 'prolonged', visitorCreated: false};
    }

    const known = db.prepare('SELECT 1 FROM visitor WHERE id = ?').get(visitorId) !== undefined;
    if (!known) {
      db.prepare('INSERT INTO visitor (id, first_seen) VALUES (?, ?)').run(visitorId, now);
    }
    db.prepare(
      `INSERT INTO session (id, visitor_id, ip, user_agent, referer, lang, started_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, visitorId, input.ip, input.userAgent, input.referer, input.lang, now, now);
    return {outcome: 'created', visitorCreated: !known};
  });
}

/** Un visiteur par identifiant, ou `undefined`. */
export function findVisitor(id: string): Visitor | undefined {
  const row = journal()
    .prepare('SELECT id, name, note, first_seen FROM visitor WHERE id = ?')
    .get(id) as
    | {id: string; name: string | null; note: string | null; first_seen: string}
    | undefined;
  if (row === undefined) return undefined;
  return {id: row.id, name: row.name, note: row.note, firstSeen: row.first_seen};
}

/** Une session par identifiant, ou `undefined`. */
export function findSession(id: string): Session | undefined {
  const row = journal()
    .prepare(
      `SELECT id, visitor_id, ip, ip_label, user_agent, referer, lang, started_at, last_seen_at
       FROM session WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        visitor_id: string;
        ip: string;
        ip_label: string | null;
        user_agent: string | null;
        referer: string | null;
        lang: string;
        started_at: string;
        last_seen_at: string;
      }
    | undefined;
  if (row === undefined) return undefined;
  return {
    id: row.id,
    visitorId: row.visitor_id,
    ip: row.ip,
    ipLabel: row.ip_label,
    userAgent: row.user_agent,
    referer: row.referer,
    lang: row.lang,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at
  };
}

import type {ExchangeKind, ExchangeStatus} from './schema';

export {EXCHANGE_KINDS, EXCHANGE_STATUSES} from './schema';
export type {ExchangeKind, ExchangeStatus} from './schema';

/** Ce que l'appelant sait d'un échange déjà répondu — jamais la requête. */
export type AddExchangeInput = {
  /** La session à laquelle l'échange se rattache, un ULID validé par l'appelant. */
  readonly sessionId: string;
  /**
   * `hero` seulement : un échange inséré déjà répondu, sans jetons ni coût.
   * Les échanges `chat` et `match` suivent la séquence d'AD-6 — réservation
   * en `pending`, puis finalisation — que la story 6 apporte ; les accepter
   * ici journaliserait un appel au modèle comme s'il avait été gratuit.
   */
  readonly kind: 'hero';
  readonly question: string;
  readonly answer: string;
  /** Les clés de citation, `qa:<id>` ou `cv:<chemin>` (AD-4). */
  readonly sources: readonly string[];
  /** Résultat du contrôle des citations — vrai d'office pour une réponse écrite. */
  readonly citationOk: boolean;
  readonly latencyMs: number;
  /** L'instant de l'échange ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

export type Exchange = {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: ExchangeKind;
  readonly status: ExchangeStatus;
  readonly question: string;
  readonly answer: string | null;
  readonly sources: readonly string[] | null;
  readonly citationOk: boolean | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly costMicroUsd: number | null;
  readonly latencyMs: number | null;
  /** ISO 8601 UTC. */
  readonly at: string;
};

/**
 * Insère un échange **déjà répondu** — le cas des questions du premier écran :
 * la réponse est celle du corpus, aucun jeton n'a été consommé, le coût est
 * nul et les citations sont exactes par construction (AD-7 : insertion, rien
 * d'autre). `status = 'done'` d'emblée, les quatre compteurs de jetons à `NULL`
 * : ils n'existent que pour un appel au modèle, et un zéro y ferait croire à un
 * appel gratuit.
 *
 * La session doit exister : la clé étrangère le garantit, et un échange sans
 * session est refusé par la base — l'appelant a créé ou prolongé la session
 * juste avant (`touchSession`), il ne reste qu'à s'y rattacher. L'identifiant
 * est un ULID daté de l'instant de l'échange, comme les autres.
 */
export function addExchange(input: AddExchangeInput): {readonly id: string} {
  if (!isUlid(input.sessionId)) {
    throw new TypeError('addExchange : sessionId doit être un ULID validé');
  }
  if (input.kind !== 'hero') {
    throw new TypeError(`addExchange : kind « ${String(input.kind)} » — seul hero s'insère déjà répondu`);
  }
  if (input.question.trim() === '' || input.answer.trim() === '') {
    // `NOT NULL` laisse passer une chaîne vide : un échange sans texte serait
    // indiscernable d'une vraie réponse pour l'admin.
    throw new TypeError('addExchange : question et answer ne peuvent pas être vides');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('addExchange : now doit être une date valide');
  }
  // Une latence qui n'est pas un nombre fini n'est pas une mesure : zéro.
  const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(input.latencyMs)) : 0;
  const id = ulid(now.getTime());
  const db = journal();

  transaction(db, () => {
    db.prepare(
      `INSERT INTO exchange (id, session_id, kind, status, question, answer, sources, citation_ok,
                             input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                             cost_micro_usd, latency_ms, at)
       VALUES (?, ?, ?, 'done', ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?)`
    ).run(
      id,
      input.sessionId,
      input.kind,
      input.question,
      input.answer,
      JSON.stringify(input.sources),
      input.citationOk ? 1 : 0,
      latency,
      now.toISOString()
    );
  });
  return {id};
}

/**
 * Les `sources` d'une ligne, relues depuis leur JSON. Une valeur qui n'est pas
 * un tableau de chaînes — impossible par ce module, mais la colonne est du
 * texte — vaut `null` plutôt qu'une forme que le type ne promet pas.
 */
function parseSources(value: string | null): readonly string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/** Un échange par identifiant, ou `undefined`. */
export function findExchange(id: string): Exchange | undefined {
  const row = journal()
    .prepare(
      `SELECT id, session_id, kind, status, question, answer, sources, citation_ok,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              cost_micro_usd, latency_ms, at
       FROM exchange WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        session_id: string;
        kind: ExchangeKind;
        status: ExchangeStatus;
        question: string;
        answer: string | null;
        sources: string | null;
        citation_ok: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        cache_read_tokens: number | null;
        cache_creation_tokens: number | null;
        cost_micro_usd: number | null;
        latency_ms: number | null;
        at: string;
      }
    | undefined;
  if (row === undefined) return undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    status: row.status,
    question: row.question,
    answer: row.answer,
    sources: parseSources(row.sources),
    citationOk: row.citation_ok === null ? null : row.citation_ok === 1,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    costMicroUsd: row.cost_micro_usd,
    latencyMs: row.latency_ms,
    at: row.at
  };
}
