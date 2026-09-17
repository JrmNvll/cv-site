/**
 * Le schéma de `usage.db` — les trois entités du squelette d'architecture
 * (`erDiagram` de l'`ARCHITECTURE-SPINE`), créées ensemble dès la première
 * ouverture. `exchange` reçoit les questions du premier écran (`kind = 'hero'`,
 * coût nul) et les appels au modèle (`chat`, puis `match`) : réservés en
 * `pending` avant l'appel, finalisés après (AD-6).
 *
 * Conventions (AD-7 et « Identifiants & dates ») :
 *  - tables et colonnes en `snake_case`, identifiants ULID en texte ;
 *  - horodatages ISO 8601 UTC (`2026-09-15T10:00:00.000Z`), donc triables et
 *    comparables tels quels ;
 *  - coûts en micro-USD entiers ;
 *  - tables `STRICT` : SQLite refuse une valeur d'un autre type que celui
 *    déclaré, au lieu de la convertir en silence.
 *
 * Aucune suppression, aucune purge, aucune table d'agrégat : statistiques et
 * cumul de dépense se calculent à la lecture — d'où les index sur `exchange(at)`
 * et `exchange(session_id, at)`. `tests/unit/journal.test.ts` relit ce fichier
 * et refuse toute instruction destructive.
 */

/**
 * Version du schéma, portée par `PRAGMA user_version`. Le code refuse d'ouvrir
 * une base plus récente que ce qu'il connaît — et, tant qu'aucune base de
 * production n'existe, une base plus ancienne aussi : il n'y a pas encore de
 * mécanisme de migration (`deferred-work.md`), le DDL idempotent ne retouche
 * pas une contrainte déjà posée, et une base d'avant la mise en ligne se recrée.
 *
 * Historique :
 *  - 1 : les trois tables, `exchange.kind` limité à `chat` et `match` ;
 *  - 2 : `exchange.kind` admet `hero` — les questions du premier écran, servies
 *    sans appel au modèle ;
 *  - 3 : `exchange.status` admet `cap_reached` — une question refusée au
 *    plafond de dépense, journalisée « dans tous les cas » (AD-16), coût nul.
 */
export const SCHEMA_VERSION = 3;

/**
 * Les sortes d'échange, liste close. `hero` : une des questions du premier
 * écran, servie sans appel au modèle ; `chat` et `match` : les deux routes qui
 * l'appellent (AD-16). Le `CHECK` du DDL est **dérivé** de cette liste : une
 * seule vérité, pas deux à tenir à la main.
 */
export const EXCHANGE_KINDS = ['chat', 'match', 'hero'] as const;
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];

/**
 * Les états d'un échange (AD-6, AD-16) — même règle. `pending` : réservé
 * avant l'appel, `cost_micro_usd` vaut la réservation ; `done` : répondu ;
 * `model_error` : l'appel a échoué, avant ou pendant le flux ; `cap_reached` :
 * refusé au plafond, sans appel, coût nul. Les refus de débit, eux, ne
 * s'écrivent pas — ce serait un vecteur de croissance de la base.
 */
export const EXCHANGE_STATUSES = ['pending', 'done', 'model_error', 'cap_reached'] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

/** `'a', 'b'` — la liste telle qu'un `CHECK (x IN (…))` l'attend. */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * Réglages de connexion, appliqués à **chaque** ouverture, dans cet ordre :
 *  - `busy_timeout` d'abord : le passage en WAL prend lui-même un verrou, et
 *    une base tenue par un autre processus au démarrage (sauvegarde, outil
 *    `sqlite3`) échouerait en `SQLITE_BUSY` avant d'avoir posé l'attente.
 *    Une seconde, pas plus : `DatabaseSync` attend **en bloquant la boucle
 *    Node**, donc toutes les requêtes du site avec elle. Le site n'a qu'une
 *    connexion par processus, seul un outil externe peut tenir le verrou ;
 *  - `journal_mode = WAL` : lecteurs et écrivain ne se bloquent pas ;
 *    persistant dans le fichier, la réexécution est sans effet ;
 *  - `foreign_keys = ON` : une session sans visiteur, un échange sans session
 *    sont refusés par la base, pas seulement par le code.
 */
export const BUSY_TIMEOUT_MS = 1000;
export const PRAGMAS = [
  `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`,
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON'
] as const;

/** Le DDL, idempotent : `IF NOT EXISTS` partout, un redémarrage ne touche à rien. */
export const DDL = `
CREATE TABLE IF NOT EXISTS visitor (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  note        TEXT,
  first_seen  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS session (
  id            TEXT PRIMARY KEY,
  visitor_id    TEXT NOT NULL REFERENCES visitor(id),
  ip            TEXT NOT NULL,
  ip_label      TEXT,
  user_agent    TEXT,
  referer       TEXT,
  lang          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS session_visitor_id ON session(visitor_id);
-- Pour l'admin (story 8) : étiqueter une adresse, lister par activité récente.
-- Posés maintenant : un index coûte zéro sur une base vide, une migration plus tard.
CREATE INDEX IF NOT EXISTS session_ip ON session(ip);
CREATE INDEX IF NOT EXISTS session_last_seen_at ON session(last_seen_at);

CREATE TABLE IF NOT EXISTS exchange (
  id                     TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL REFERENCES session(id),
  kind                   TEXT NOT NULL CHECK (kind IN (${sqlList(EXCHANGE_KINDS)})),
  status                 TEXT NOT NULL CHECK (status IN (${sqlList(EXCHANGE_STATUSES)})),
  question               TEXT NOT NULL,
  answer                 TEXT,
  sources                TEXT,
  citation_ok            INTEGER,
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  cache_read_tokens      INTEGER,
  cache_creation_tokens  INTEGER,
  cost_micro_usd         INTEGER,
  latency_ms             INTEGER,
  at                     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS exchange_at ON exchange(at);
CREATE INDEX IF NOT EXISTS exchange_session_id_at ON exchange(session_id, at);
`;
