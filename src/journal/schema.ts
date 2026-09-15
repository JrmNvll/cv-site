/**
 * Le schéma de `usage.db` — les trois entités du squelette d'architecture
 * (`erDiagram` de l'`ARCHITECTURE-SPINE`), créées ensemble dès la première
 * ouverture. `exchange` reste vide jusqu'à la story « échanges » : la table
 * existe pour que le schéma soit posé une fois, pas par morceaux.
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
 * Version du schéma, portée par `PRAGMA user_version`. Une évolution future
 * l'incrémente et ajoute sa migration ; le code refuse d'ouvrir une base plus
 * récente que ce qu'il connaît.
 */
export const SCHEMA_VERSION = 1;

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
  kind                   TEXT NOT NULL CHECK (kind IN ('chat', 'match')),
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'done', 'model_error')),
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
