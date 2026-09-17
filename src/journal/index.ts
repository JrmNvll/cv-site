/**
 * Couche `journal` — frontière.
 *
 * Responsabilité : seul propriétaire de `usage.db` (`node:sqlite`, fichier dans
 * `DATA_DIR`) — visiteurs, sessions, échanges, cumul de dépense, étiquettes
 * d'adresse. Écritures en insertion, plus la liste fermée de colonnes
 * modifiables d'AD-7 : `session.last_seen_at`, la finalisation d'un échange
 * réservé (`status`, `answer`, `sources`, `citation_ok`, les quatre compteurs,
 * `cost_micro_usd`, `latency_ms`), et les trois choses que l'admin écrit —
 * `visitor.name`, `visitor.note`, `ip_label.label` (avec son `at`) — et rien
 * d'autre. Aucune suppression, aucune purge, aucune table d'agrégat : le cumul
 * du mois est une somme à la lecture, les classements de l'admin aussi.
 *
 * Dépendances autorisées : `src/env.ts`, `src/lib/`, `node:sqlite`, ses propres
 * types. Interdites : `content`, `knowledge`, `agent`, `app`. Le journal ne
 * connaît ni HTTP ni Next : visiteur, session, adresse, navigateur, provenance
 * et langue lui sont **passés** — c'est ce qui le rend testable sur une base
 * temporaire sans monter Next, et ce qui garantit une seule lecture des cookies
 * (AD-14) et une seule source pour l'adresse (AD-15).
 *
 * **Surface publique.** `touchSession()` est le seul point d'entrée qui crée ou
 * prolonge une session. Trois portes insèrent un échange : `addExchange()`,
 * finalisé d'emblée, pour les réponses servies sans appel au modèle ;
 * `reserveExchange()`, en `pending` avec la réservation, **avant** un appel au
 * modèle — et c'est elle qui tient le plafond, cumul et insertion dans la même
 * transaction —, que `finalizeExchange()` clôt ensuite avec les quatre
 * compteurs et le coût réel (AD-6) ; `recordCapRefusal()`, pour une question
 * refusée au plafond. `monthSpendMicroUsd()` est le cumul du mois — une somme,
 * jamais un compteur —, `recentExchanges()` l'historique d'une session pour le
 * contexte (AD-3), et `settleStalePending()` règle au démarrage les
 * réservations qu'un arrêt brutal a laissées ouvertes. `findVisitor()`,
 * `findSession()` et `findExchange()` sont la lecture minimale dont les tests
 * ont besoin ; `ensureJournal()` ouvre la base à l'amorçage sans en rendre la
 * connexion — l'application n'a pas à la tenir. Seuls les tests passent par
 * `./db` pour ouvrir une base temporaire.
 *
 * **Pour l'admin** (story 8, CAP-7) : les lectures agrégées — `journalStats()`,
 * `listSessions()`, `sessionExchanges()`, `visitorSessions()`, `topQuestions()`,
 * `ipLabel()` — et les trois écritures d'AD-7 : `setVisitor()` (nom, note) et
 * `setIpLabel()` (l'étiquette d'une **adresse**, portée par `ip_label` : elle
 * suit l'adresse, sessions passées et futures comprises). Rien ne s'efface :
 * un nom ou une étiquette « retirés » deviennent une chaîne vide.
 */
import {isIP} from 'node:net';
import type {DatabaseSync} from 'node:sqlite';
import {DEV_CLIENT_IP, UNKNOWN_CLIENT_IP} from '@/lib/client-ip';
import {isUlid, ulid} from '@/lib/ulid';
import {journal} from './db';

/**
 * Ouvre `DATA_DIR/usage.db` — pour l'amorçage (`src/lib/startup.ts`), qui
 * veut qu'un `DATA_DIR` inaccessible arrête le processus avant la première
 * requête, et n'a rien à faire de la connexion elle-même. Règle au passage
 * les réservations qu'un arrêt brutal aurait laissées `pending` : sans cela,
 * une réservation orpheline compterait dans le cumul tout le mois, sans que
 * rien ne le dise.
 */
export function ensureJournal(): void {
  journal();
  const settled = settleStalePending(new Date());
  if (settled > 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'journal.pending_settled',
        count: settled,
        staleMs: PENDING_STALE_MS,
        text: `${settled} réservation(s) restée(s) pending plus de ${PENDING_STALE_MS / 60_000} min, finalisée(s) en model_error à la réservation.`
      })
    );
  }
}

/**
 * Au-delà, une ligne `pending` n'attend plus rien : aucun appel ne dure dix
 * minutes (la passerelle abandonne le flux bien avant), le processus qui l'a
 * réservée est mort avant de la finaliser.
 */
export const PENDING_STALE_MS = 10 * 60_000;

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
  /** L'étiquette de l'adresse ne vit pas ici : voir `ipLabel(ip)` et `listSessions()`. */
  readonly ip: string;
  readonly userAgent: string | null;
  readonly referer: string | null;
  readonly lang: string;
  /** ISO 8601 UTC. */
  readonly startedAt: string;
  /** ISO 8601 UTC. */
  readonly lastSeenAt: string;
};

/**
 * Une transaction de **lecture** (`BEGIN` différé) : deux requêtes qui se
 * suivent — un compte, puis une page — voient le même état commis, sans
 * prendre le verrou d'écriture.
 */
function readTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    return work();
  } finally {
    db.exec('COMMIT');
  }
}

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
      `SELECT id, visitor_id, ip, user_agent, referer, lang, started_at, last_seen_at
       FROM session WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        visitor_id: string;
        ip: string;
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
 * Au-delà, une session n'insère plus de `hero` : rien ne limite une question
 * qui ne coûte rien, et un script qui cliquerait en boucle ferait grossir la
 * base pour toujours (AD-7 — report de la story 5). Cent réponses préparées
 * par session, c'est vingt fois les cinq puces : un humain n'y arrive pas.
 */
export const HERO_EXCHANGES_PER_SESSION = 100;

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
 *
 * Rend `null`, sans rien écrire, quand la session a déjà atteint
 * `HERO_EXCHANGES_PER_SESSION` : la réponse est servie quand même, elle n'est
 * plus journalisée.
 */
export function addExchange(input: AddExchangeInput): {readonly id: string} | null {
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

  return transaction(db, () => {
    // Compté dans la transaction : deux clics simultanés ne passent pas tous
    // deux sous la borne.
    const {n} = db
      .prepare("SELECT count(*) AS n FROM exchange WHERE session_id = ? AND kind = 'hero'")
      .get(input.sessionId) as {n: number};
    if (n >= HERO_EXCHANGES_PER_SESSION) return null;

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
    return {id};
  });
}

/** Les sortes d'échange qui appellent le modèle — réservées, puis finalisées (AD-6). */
export type ModelExchangeKind = Exclude<ExchangeKind, 'hero'>;

/** Ce que la passerelle sait **avant** l'appel : la question, ce qu'elle réserve, et le plafond. */
export type ReserveExchangeInput = {
  readonly sessionId: string;
  readonly kind: ModelExchangeKind;
  readonly question: string;
  /** Le coût estimé de l'appel, en micro-USD entiers — compté dans le cumul tant que l'échange est `pending`. */
  readonly reservationMicroUsd: number;
  /** Le plafond mensuel, en micro-USD entiers : la réservation est refusée si cumul + réservation le dépasse. */
  readonly capMicroUsd: number;
  /** L'instant de la réservation ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/** Réservé — ou refusé au plafond, avec le cumul du mois qui a décidé. */
export type ReserveOutcome =
  | {readonly id: string; readonly capReached?: undefined}
  | {readonly capReached: true; readonly spentMicroUsd: number};

/** Un entier positif ou nul, ou une erreur — un coût n'est jamais approximatif. */
function microUsd(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${what} doit être un entier de micro-USD positif ou nul`);
  }
  return value;
}

/**
 * Réserve un échange **avant** l'appel au modèle (AD-6, étapes 1 à 3), en une
 * seule transaction `BEGIN IMMEDIATE` : le cumul du mois est lu, comparé au
 * plafond, et la ligne `pending` insérée — sans qu'aucune autre réservation
 * puisse se glisser entre les deux. C'est **ici** que le plafond tient, pas
 * dans la passerelle : deux requêtes simultanées ne peuvent pas passer toutes
 * deux juste sous 5 USD, quel que soit ce qu'un `await` fera un jour dans le
 * code appelant.
 *
 * Réservée : une ligne `pending` dont `cost_micro_usd` vaut la réservation,
 * comptée dans le cumul dès maintenant ; ni réponse, ni sources, ni compteurs,
 * `finalizeExchange()` les posera. Refusée : rien n'est écrit, l'appelant
 * journalise le refus (`recordCapRefusal`). Une réservation qui **échoue** —
 * base verrouillée, disque plein — lève : la passerelle n'appelle alors pas
 * le modèle.
 */
export function reserveExchange(input: ReserveExchangeInput): ReserveOutcome {
  if (!isUlid(input.sessionId)) {
    throw new TypeError('reserveExchange : sessionId doit être un ULID validé');
  }
  if (input.kind === ('hero' as string)) {
    throw new TypeError('reserveExchange : hero ne se réserve pas, il s’insère déjà répondu');
  }
  if (input.question.trim() === '') {
    throw new TypeError('reserveExchange : question ne peut pas être vide');
  }
  const reservation = microUsd(input.reservationMicroUsd, 'reserveExchange : reservationMicroUsd');
  const cap = microUsd(input.capMicroUsd, 'reserveExchange : capMicroUsd');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('reserveExchange : now doit être une date valide');
  }
  const id = ulid(now.getTime());
  const db = journal();

  return transaction(db, () => {
    const spent = monthSpendWith(db, now);
    if (spent + reservation > cap) return {capReached: true, spentMicroUsd: spent};
    db.prepare(
      `INSERT INTO exchange (id, session_id, kind, status, question, answer, sources, citation_ok,
                             input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                             cost_micro_usd, latency_ms, at)
       VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?)`
    ).run(id, input.sessionId, input.kind, input.question, reservation, now.toISOString());
    return {id};
  });
}

/** Les quatre compteurs de `usage` que l'API rend (AD-6, étape 3). */
export type ExchangeUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
};

/** Ce que la passerelle sait **après** l'appel — ou après son échec. */
export type FinalizeExchangeInput = {
  readonly id: string;
  /** `done` : répondu, fin de tour normale ; `model_error` : exception du SDK ou du réseau, avant ou pendant le flux. */
  readonly status: 'done' | 'model_error';
  /** Le texte reçu, sans le bloc `<sources>` — partiel, ou vide, après une erreur. */
  readonly answer: string;
  /** Les sources **valides** seulement (AD-4) ; `[]` après une erreur. */
  readonly sources: readonly string[];
  /** Résultat du contrôle des citations ; `null` quand il n'a pas eu lieu (erreur). */
  readonly citationOk: boolean | null;
  /** Les compteurs rendus par l'API, ou `null` si l'appel n'en a pas rendu. */
  readonly usage: ExchangeUsage | null;
  /** Le coût réel depuis la table de prix — ou la réservation, faute de compteurs. */
  readonly costMicroUsd: number;
  readonly latencyMs: number;
};

/**
 * La seule instruction qui touche un `exchange` (AD-7 : la liste fermée des
 * colonnes modifiables), sur **une ligne `pending`** et rien d'autre. Rend le
 * nombre de lignes atteintes : 0 ou 1. Partagée par la finalisation d'un appel
 * et par le règlement des réservations orphelines au démarrage.
 */
function applyFinalization(
  db: DatabaseSync,
  input: Omit<FinalizeExchangeInput, 'costMicroUsd' | 'latencyMs'> & {
    readonly costMicroUsd: number;
    readonly latencyMs: number;
  }
): number {
  const usage = input.usage;
  const {changes} = db
    .prepare(
      `UPDATE exchange
       SET status = ?, answer = ?, sources = ?, citation_ok = ?,
           input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?,
           cost_micro_usd = ?, latency_ms = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(
      input.status,
      input.answer,
      JSON.stringify(input.sources),
      input.citationOk === null ? null : input.citationOk ? 1 : 0,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.cacheReadTokens ?? null,
      usage?.cacheCreationTokens ?? null,
      input.costMicroUsd,
      input.latencyMs,
      input.id
    );
  return Number(changes);
}

/**
 * Finalise un échange réservé (AD-6, étape 3). N'atteint **qu'une ligne
 * `pending`** : une ligne déjà finalisée, ou inconnue, fait lever — une double
 * finalisation écraserait le coût réel, et une finalisation sans réservation
 * aurait contourné le cumul.
 */
export function finalizeExchange(input: FinalizeExchangeInput): void {
  if (!isUlid(input.id)) {
    throw new TypeError('finalizeExchange : id doit être un ULID validé');
  }
  if (input.status !== 'done' && input.status !== 'model_error') {
    throw new TypeError(`finalizeExchange : statut « ${String(input.status)} » hors de done | model_error`);
  }
  const cost = microUsd(input.costMicroUsd, 'finalizeExchange : costMicroUsd');
  const usage = input.usage;
  if (usage !== null) {
    for (const [name, value] of Object.entries(usage)) {
      if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`finalizeExchange : usage.${name} doit être un entier positif ou nul`);
      }
    }
  }
  const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(input.latencyMs)) : 0;
  const db = journal();

  transaction(db, () => {
    const changes = applyFinalization(db, {...input, costMicroUsd: cost, latencyMs: latency});
    if (changes !== 1) {
      throw new Error(
        `finalizeExchange : aucun échange pending « ${input.id} » — déjà finalisé, ou jamais réservé`
      );
    }
  });
}

/**
 * Règle les réservations orphelines : toute ligne `pending` vieille de
 * `PENDING_STALE_MS` ou plus est finalisée en `model_error`, sans réponse, sans
 * source, sans compteurs, **à la réservation** — ce qu'elle a coûté au plus.
 * Chaque ligne passe par la même instruction que la finalisation d'un appel :
 * rien d'autre ne touche un `exchange`. Rend le nombre de lignes réglées.
 */
export function settleStalePending(now: Date): number {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('settleStalePending : now doit être une date valide');
  }
  const before = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
  const db = journal();
  return transaction(db, () => {
    const stale = db
      .prepare("SELECT id, cost_micro_usd FROM exchange WHERE status = 'pending' AND at <= ?")
      .all(before) as {id: string; cost_micro_usd: number | null}[];
    let settled = 0;
    for (const row of stale) {
      settled += applyFinalization(db, {
        id: row.id,
        status: 'model_error',
        answer: '',
        sources: [],
        citationOk: null,
        usage: null,
        costMicroUsd: row.cost_micro_usd ?? 0,
        latencyMs: 0
      });
    }
    return settled;
  });
}

/** Une question refusée au plafond : ce qu'il en reste à journaliser. */
export type CapRefusalInput = {
  readonly sessionId: string;
  readonly kind: ModelExchangeKind;
  readonly question: string;
  /** L'instant du refus ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/**
 * Journalise une question refusée au plafond de dépense (AD-6, étape 2 ;
 * AD-16 : « l'échange est journalisé dans tous les cas »). `status =
 * 'cap_reached'`, coût nul, la question conservée — Jérémie doit pouvoir lire
 * ce qu'on lui a demandé pendant que l'assistant se taisait. Aucun appel n'a eu
 * lieu : ni réponse, ni compteurs.
 */
export function recordCapRefusal(input: CapRefusalInput): {readonly id: string} {
  if (!isUlid(input.sessionId)) {
    throw new TypeError('recordCapRefusal : sessionId doit être un ULID validé');
  }
  if (input.kind === ('hero' as string)) {
    throw new TypeError('recordCapRefusal : hero ne coûte rien, il n’atteint pas le plafond');
  }
  if (input.question.trim() === '') {
    throw new TypeError('recordCapRefusal : question ne peut pas être vide');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('recordCapRefusal : now doit être une date valide');
  }
  const id = ulid(now.getTime());
  const db = journal();

  transaction(db, () => {
    db.prepare(
      `INSERT INTO exchange (id, session_id, kind, status, question, answer, sources, citation_ok,
                             input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                             cost_micro_usd, latency_ms, at)
       VALUES (?, ?, ?, 'cap_reached', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?)`
    ).run(id, input.sessionId, input.kind, input.question, now.toISOString());
  });
  return {id};
}

/** Le premier jour du mois de `now`, à minuit UTC, en ISO 8601 — comparable tel quel à `exchange.at`. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** La somme du mois, sur une connexion donnée — dans ou hors transaction. */
function monthSpendWith(db: DatabaseSync, now: Date): number {
  const {total} = db
    .prepare('SELECT coalesce(sum(cost_micro_usd), 0) AS total FROM exchange WHERE at >= ?')
    .get(monthStart(now)) as {total: number};
  return total;
}

/**
 * Le cumul du mois, en micro-USD : la somme de `exchange.cost_micro_usd`
 * depuis le 1er du mois UTC, réservations `pending` **comprises** (AD-6,
 * étape 1). Aucune table de compteur : une somme à la lecture, sur l'index
 * `exchange(at)` — un redémarrage ne remet donc rien à zéro. Une lecture pour
 * qui veut savoir (tests, admin) ; la réservation, elle, fait sa propre somme
 * dans sa transaction.
 */
export function monthSpendMicroUsd(now: Date = new Date()): number {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('monthSpendMicroUsd : now doit être une date valide');
  }
  return monthSpendWith(journal(), now);
}

/** Un échange répondu, tel que l'historique du contexte le reprend (AD-3). */
export type RecentExchange = {
  readonly id: string;
  readonly kind: ExchangeKind;
  readonly question: string;
  /** Sans bloc `<sources>` : il n'a jamais été écrit en base. */
  readonly answer: string;
  /** ISO 8601 UTC. */
  readonly at: string;
};

/**
 * Les `limit` derniers échanges `done` d'une session, **du plus ancien au plus
 * récent** — l'ordre d'une conversation. Toute sorte confondue : une question
 * du premier écran fait partie de ce que le visiteur a déjà lu. Un échange
 * `pending`, en erreur ou refusé n'a rien à reprendre.
 */
export function recentExchanges(sessionId: string, limit: number): readonly RecentExchange[] {
  if (!isUlid(sessionId)) {
    throw new TypeError('recentExchanges : sessionId doit être un ULID validé');
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError('recentExchanges : limit doit être un entier positif ou nul');
  }
  if (limit === 0) return [];
  const rows = journal()
    .prepare(
      `SELECT id, kind, question, answer, at FROM exchange
       WHERE session_id = ? AND status = 'done'
       ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all(sessionId, limit) as {
    id: string;
    kind: ExchangeKind;
    question: string;
    answer: string | null;
    at: string;
  }[];
  return rows
    .reverse()
    .map((row) => ({id: row.id, kind: row.kind, question: row.question, answer: row.answer ?? '', at: row.at}));
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

type ExchangeRow = {
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
};

const EXCHANGE_COLUMNS = `id, session_id, kind, status, question, answer, sources, citation_ok,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       cost_micro_usd, latency_ms, at`;

function mapExchange(row: ExchangeRow): Exchange {
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

/** Un échange par identifiant, ou `undefined`. */
export function findExchange(id: string): Exchange | undefined {
  const row = journal()
    .prepare(`SELECT ${EXCHANGE_COLUMNS} FROM exchange WHERE id = ?`)
    .get(id) as ExchangeRow | undefined;
  return row === undefined ? undefined : mapExchange(row);
}

/*
 * ---------------------------------------------------------------------------
 * L'admin (story 8, CAP-7) — lectures agrégées et les trois écritures d'AD-7.
 * ---------------------------------------------------------------------------
 */

/** Bornes des trois textes que l'admin écrit, en caractères. */
export const VISITOR_NAME_MAX = 120;
export const VISITOR_NOTE_MAX = 2000;
export const IP_LABEL_MAX = 120;
/** Une page de la liste des sessions. */
export const SESSIONS_PER_PAGE = 50;
/** Au-delà, la fiche d'un visiteur ne montre plus tout : les plus récentes, et le dit. */
export const VISITOR_SESSIONS_MAX = 200;
/** Lignes de chaque classement des questions. */
export const TOP_QUESTIONS = 50;

/** Un texte de l'admin, borné — l'appelant a déjà normalisé (blancs, invisibles). */
function boundedText(value: string, max: number, what: string): string {
  if (typeof value !== 'string' || value.length > max || !value.isWellFormed()) {
    throw new TypeError(`${what} doit être une chaîne bien formée de ${max} caractères au plus`);
  }
  return value;
}

/** Ce que le tableau de bord affiche en tête. */
export type JournalStats = {
  /** Le cumul du mois de `now`, réservations `pending` comprises. */
  readonly monthSpendMicroUsd: number;
  /** Toutes les sessions, depuis le début. */
  readonly sessions: number;
  /** Tous les échanges, toute sorte et tout statut, depuis le début. */
  readonly exchanges: number;
};

/** Trois comptes à la lecture — aucun compteur tenu à part. */
export function journalStats(now: Date = new Date()): JournalStats {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('journalStats : now doit être une date valide');
  }
  const db = journal();
  const {n: sessions} = db.prepare('SELECT count(*) AS n FROM session').get() as {n: number};
  const {n: exchanges} = db.prepare('SELECT count(*) AS n FROM exchange').get() as {n: number};
  return {monthSpendMicroUsd: monthSpendWith(db, now), sessions, exchanges};
}

/** Une session telle que les listes de l'admin la montrent : jointe au visiteur et à l'étiquette de son adresse. */
export type SessionSummary = Session & {
  /** `visitor.name` — `null` ou vide si l'admin n'a rien posé. */
  readonly visitorName: string | null;
  /** `ip_label.label` de l'adresse — `null` sans étiquette, vide si retirée. */
  readonly ipLabel: string | null;
  /** Nombre d'échanges de la session, toute sorte et tout statut. */
  readonly exchanges: number;
  /** Somme de `cost_micro_usd` des échanges de la session. */
  readonly costMicroUsd: number;
};

type SessionSummaryRow = {
  id: string;
  visitor_id: string;
  visitor_name: string | null;
  ip: string;
  ip_label: string | null;
  user_agent: string | null;
  referer: string | null;
  lang: string;
  started_at: string;
  last_seen_at: string;
  exchanges: number;
  cost_micro_usd: number;
};

/**
 * Le `SELECT` commun des listes : une ligne par session, du plus récemment
 * actif au plus ancien, avec le nom du visiteur, l'étiquette de l'adresse
 * (jointure sur `ip_label`, donc valable pour toute session passée ou future
 * de cette adresse), le nombre et le coût de ses échanges — deux sommes à la
 * lecture, sur l'index `exchange(session_id, at)`.
 */
function sessionSummaries(
  where: string,
  params: readonly (string | number)[],
  limit: {readonly count: number; readonly offset: number} | null = null
): SessionSummary[] {
  const rows = journal()
    .prepare(
      `SELECT s.id, s.visitor_id, v.name AS visitor_name, s.ip, l.label AS ip_label,
              s.user_agent, s.referer, s.lang, s.started_at, s.last_seen_at,
              (SELECT count(*) FROM exchange e WHERE e.session_id = s.id) AS exchanges,
              (SELECT coalesce(sum(e.cost_micro_usd), 0) FROM exchange e WHERE e.session_id = s.id)
                AS cost_micro_usd
       FROM session s
       JOIN visitor v ON v.id = s.visitor_id
       LEFT JOIN ip_label l ON l.ip = s.ip
       ${where}
       ORDER BY s.last_seen_at DESC, s.id DESC
       ${limit === null ? '' : 'LIMIT ? OFFSET ?'}`
    )
    .all(...params, ...(limit === null ? [] : [limit.count, limit.offset])) as SessionSummaryRow[];
  return rows.map((row) => ({
    id: row.id,
    visitorId: row.visitor_id,
    visitorName: row.visitor_name,
    ip: row.ip,
    ipLabel: row.ip_label,
    userAgent: row.user_agent,
    referer: row.referer,
    lang: row.lang,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    exchanges: row.exchanges,
    costMicroUsd: row.cost_micro_usd
  }));
}

export type ListSessionsInput = {
  /** Vrai : les seules sessions ayant au moins un échange — le défaut de l'admin, qui filtre les sondes de robots à la lecture. */
  readonly withExchanges: boolean;
  /** Numéro de page, à partir de 1. */
  readonly page: number;
};

export type SessionPage = {
  readonly sessions: readonly SessionSummary[];
  readonly page: number;
  /** Nombre de sessions retenues par le filtre, toutes pages confondues. */
  readonly total: number;
  /** Nombre de pages — au moins 1, même sans session. */
  readonly pageCount: number;
};

/**
 * La liste paginée des sessions, `SESSIONS_PER_PAGE` par page — le compte et
 * la page lus dans la même transaction, pour que `pageCount` et les lignes
 * disent le même état. Une page au-delà de la dernière est vide.
 */
export function listSessions(input: ListSessionsInput): SessionPage {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new TypeError('listSessions : page doit être un entier supérieur ou égal à 1');
  }
  const filter = input.withExchanges
    ? 'WHERE EXISTS (SELECT 1 FROM exchange e WHERE e.session_id = s.id)'
    : '';
  const db = journal();
  return readTransaction(db, () => {
    const {n: total} = db.prepare(`SELECT count(*) AS n FROM session s ${filter}`).get() as {n: number};
    const sessions = sessionSummaries(filter, [], {
      count: SESSIONS_PER_PAGE,
      offset: (input.page - 1) * SESSIONS_PER_PAGE
    });
    return {sessions, page: input.page, total, pageCount: Math.max(1, Math.ceil(total / SESSIONS_PER_PAGE))};
  });
}

export type VisitorSessions = {
  /** Les `VISITOR_SESSIONS_MAX` plus récentes au plus, de la plus récente à la plus ancienne. */
  readonly sessions: readonly SessionSummary[];
  /** Toutes, comptées — la fiche dit s'il y en a plus que montré. */
  readonly total: number;
};

/** Les sessions d'un visiteur, bornées, avec leur compte — même transaction de lecture. */
export function visitorSessions(visitorId: string): VisitorSessions {
  if (!isUlid(visitorId)) {
    throw new TypeError('visitorSessions : visitorId doit être un ULID validé');
  }
  const db = journal();
  return readTransaction(db, () => {
    const {n: total} = db.prepare('SELECT count(*) AS n FROM session WHERE visitor_id = ?').get(visitorId) as {
      n: number;
    };
    const sessions = sessionSummaries('WHERE s.visitor_id = ?', [visitorId], {count: VISITOR_SESSIONS_MAX, offset: 0});
    return {sessions, total};
  });
}

/**
 * Tous les échanges d'une session, **dans l'ordre**, toute sorte et tout
 * statut — `pending`, en erreur et refusés compris : l'admin doit voir ce qui
 * a été demandé pendant que l'assistant se taisait.
 */
export function sessionExchanges(sessionId: string): readonly Exchange[] {
  if (!isUlid(sessionId)) {
    throw new TypeError('sessionExchanges : sessionId doit être un ULID validé');
  }
  const rows = journal()
    .prepare(`SELECT ${EXCHANGE_COLUMNS} FROM exchange WHERE session_id = ? ORDER BY at, id`)
    .all(sessionId) as ExchangeRow[];
  return rows.map(mapExchange);
}

/** Une puce du premier écran, comptée par identifiant d'entrée du corpus. */
export type TopHeroQuestion = {
  /** L'identifiant de l'entrée (`lic-01`), relu de la clé de citation `qa:<id>` de l'échange. */
  readonly id: string;
  readonly count: number;
  /** ISO 8601 UTC — le dernier clic. */
  readonly lastAt: string;
};

/** Une question libre ou une annonce, comptée par texte normalisé. */
export type TopFreeQuestion = {
  /** Minuscules, blancs réduits à un espace, `FREE_QUESTION_KEY_CHARS` premiers caractères. */
  readonly text: string;
  readonly kind: ModelExchangeKind;
  readonly count: number;
  /** ISO 8601 UTC — la dernière fois. */
  readonly lastAt: string;
};

export type TopQuestions = {
  readonly hero: readonly TopHeroQuestion[];
  readonly free: readonly TopFreeQuestion[];
};

/** Au-delà, deux questions libres qui commencent pareil comptent ensemble. */
export const FREE_QUESTION_KEY_CHARS = 200;

/** La clé de regroupement d'une question libre : minuscules, blancs réduits, tronquée. */
export function freeQuestionKey(question: string): string {
  return question.toLowerCase().split(/\s+/).filter(Boolean).join(' ').slice(0, FREE_QUESTION_KEY_CHARS);
}

/**
 * Les questions les plus posées, sur toute la période, `TOP_QUESTIONS` lignes
 * par classement. Les puces se comptent par identifiant — la clé de citation
 * que `addExchange` a écrite, la même dans les deux langues — ; les questions
 * libres et les annonces par `freeQuestionKey()`, sorte par sorte. Tout est
 * agrégé à la lecture : aucune table, aucun compteur (AD-7). Le second
 * classement relit chaque texte distinct : la base est petite, et le rester
 * est l'affaire de la story 11.
 */
export function topQuestions(): TopQuestions {
  const db = journal();

  const heroRows = db
    .prepare(
      `SELECT sources, count(*) AS n, max(at) AS last_at FROM exchange
       WHERE kind = 'hero' GROUP BY sources ORDER BY n DESC, last_at DESC`
    )
    .all() as {sources: string | null; n: number; last_at: string}[];
  const hero = new Map<string, {count: number; lastAt: string}>();
  for (const row of heroRows) {
    const key = parseSources(row.sources)?.[0];
    if (key === undefined || !key.startsWith('qa:')) continue;
    const id = key.slice('qa:'.length);
    const known = hero.get(id);
    if (known === undefined) hero.set(id, {count: row.n, lastAt: row.last_at});
    else hero.set(id, {count: known.count + row.n, lastAt: known.lastAt > row.last_at ? known.lastAt : row.last_at});
  }

  const freeRows = db
    .prepare(
      `SELECT kind, question, count(*) AS n, max(at) AS last_at FROM exchange
       WHERE kind IN ('chat', 'match') GROUP BY kind, question`
    )
    .all() as {kind: ModelExchangeKind; question: string; n: number; last_at: string}[];
  const free = new Map<string, TopFreeQuestion>();
  for (const row of freeRows) {
    const text = freeQuestionKey(row.question);
    const key = `${row.kind}\n${text}`;
    const known = free.get(key);
    free.set(key, {
      text,
      kind: row.kind,
      count: (known?.count ?? 0) + row.n,
      lastAt: known !== undefined && known.lastAt > row.last_at ? known.lastAt : row.last_at
    });
  }

  const byCount = <T extends {count: number; lastAt: string}>(a: T, b: T) =>
    b.count - a.count || (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0);
  return {
    hero: [...hero.entries()]
      .map(([id, {count, lastAt}]) => ({id, count, lastAt}))
      .sort(byCount)
      .slice(0, TOP_QUESTIONS),
    free: [...free.values()].sort(byCount).slice(0, TOP_QUESTIONS)
  };
}

export type SetVisitorInput = {
  readonly id: string;
  /** Vide pour retirer le nom. */
  readonly name: string;
  /** Vide pour retirer la note. */
  readonly note: string;
};

/**
 * Nomme ou annote un visiteur — deux des trois colonnes qu'AD-7 laisse à
 * l'admin. Rend `false`, sans rien écrire, si le visiteur est inconnu.
 */
export function setVisitor(input: SetVisitorInput): boolean {
  if (!isUlid(input.id)) {
    throw new TypeError('setVisitor : id doit être un ULID validé');
  }
  const name = boundedText(input.name, VISITOR_NAME_MAX, 'setVisitor : name');
  const note = boundedText(input.note, VISITOR_NOTE_MAX, 'setVisitor : note');
  const db = journal();
  return transaction(db, () => {
    const {changes} = db
      .prepare('UPDATE visitor SET name = ?, note = ? WHERE id = ?')
      .run(name, note, input.id);
    return Number(changes) === 1;
  });
}

/** Une adresse telle que `clientIp()` la rend : IPv4, IPv6, `dev` ou `unknown`. */
export function isJournalIp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEV_CLIENT_IP || value === UNKNOWN_CLIENT_IP || isIP(value) !== 0)
  );
}

export type SetIpLabelInput = {
  readonly ip: string;
  /** Vide pour retirer l'étiquette. */
  readonly label: string;
  /** L'instant de la pose ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/**
 * Étiquette une adresse — la troisième écriture d'AD-7. Une ligne par
 * adresse : insérée si l'adresse n'en avait pas, sinon sa valeur et `at`
 * changent. L'étiquette apparaît sur **toutes** les sessions de l'adresse,
 * passées et futures, par la jointure de `sessionSummaries`.
 */
export function setIpLabel(input: SetIpLabelInput): void {
  if (!isJournalIp(input.ip)) {
    throw new TypeError('setIpLabel : ip doit être une adresse IP, « dev » ou « unknown »');
  }
  const label = boundedText(input.label, IP_LABEL_MAX, 'setIpLabel : label');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('setIpLabel : now doit être une date valide');
  }
  const at = now.toISOString();
  const db = journal();
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO ip_label (ip, label, at) VALUES (?, ?, ?)').run(input.ip, label, at);
    db.prepare('UPDATE ip_label SET label = ?, at = ? WHERE ip = ?').run(label, at, input.ip);
  });
}

export type IpLabel = {
  readonly ip: string;
  /** Vide si retirée. */
  readonly label: string;
  /** ISO 8601 UTC — la dernière pose. */
  readonly at: string;
};

/** L'étiquette d'une adresse, ou `undefined` si aucune n'a jamais été posée. */
export function ipLabel(ip: string): IpLabel | undefined {
  const row = journal().prepare('SELECT ip, label, at FROM ip_label WHERE ip = ?').get(ip) as
    | {ip: string; label: string; at: string}
    | undefined;
  return row === undefined ? undefined : {ip: row.ip, label: row.label, at: row.at};
}
