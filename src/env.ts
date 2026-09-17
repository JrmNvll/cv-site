/**
 * Configuration de l'application — AD-9.
 *
 * Toute la configuration vient de l'environnement, jamais du code : aucune URL,
 * aucun chemin, aucun secret n'est écrit en dur ailleurs que dans `.env.example`
 * (qui ne porte aucune valeur). Le schéma ci-dessous reflète **exactement** les
 * huit clés de `.env.example`.
 *
 * Le parsage a lieu au chargement du module : si une variable requise manque, le
 * démarrage échoue avec un message qui nomme la variable. Aucun repli, aucune
 * valeur par défaut inventée pour un secret ou un chemin.
 *
 * `server-only` : ce module porte la clé API. Toute tentative de l'importer
 * depuis un composant client fait échouer la compilation, pas la production.
 */
import 'server-only';
import {isAbsolute} from 'node:path';
import {z} from 'zod';

/** Chaîne requise, non vide, dont le message d'erreur nomme la variable. */
function required(name: string) {
  return z
    .string({error: `${name} est requis — variable absente (voir .env.example)`})
    .min(1, `${name} est requis — valeur vide (voir .env.example)`);
}

export const envSchema = z.object({
  /** Clé API Anthropic. Serveur uniquement, jamais transmise au navigateur (AD-6). */
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  /**
   * Adresse de l'API du modèle — **tests et simulateur seulement**. Absente en
   * production : le SDK parle alors à l'API réelle. Les tests navigateur la
   * pointent vers `tests/e2e/model-stub/server.mjs`, qui parle le format de
   * l'API sans rien facturer ; les tests unitaires vers un port fermé, pour
   * qu'un appel qui échapperait à un simulacre échoue au lieu de coûter. Elle
   * est passée **explicitement** au client du SDK (`src/agent/gateway.ts`) :
   * rien d'autre que ce fichier ne lit l'environnement.
   */
  ANTHROPIC_BASE_URL: z
    .url({
      protocol: /^https?$/,
      error: 'ANTHROPIC_BASE_URL doit être une URL absolue en http ou https (voir .env.example)'
    })
    .optional(),
  /**
   * Répertoire du contenu privé en lecture seule : cv.yaml, qa.*.md, assets/ (AD-2).
   *
   * **Absolu, et vérifié comme tel.** `server.js` du build autonome se place dans
   * `.next/standalone` avant de démarrer : un chemin relatif y désigne un
   * répertoire qui n'existe pas, et l'erreur — « cv.yaml absent » — ne dit alors
   * rien du vrai problème. Mieux vaut refuser la variable que faire chercher le
   * fichier.
   */
  CONTENT_DIR: required('CONTENT_DIR').refine(
    isAbsolute,
    'CONTENT_DIR doit être un chemin absolu (voir .env.example)'
  ),
  /**
   * Répertoire des données : usage.db, hors dépôt (AD-7).
   *
   * **Absolu, et vérifié comme tel**, pour la même raison que `CONTENT_DIR` :
   * depuis `.next/standalone`, un chemin relatif désignerait un répertoire qui
   * n'existe pas, et le journal refuserait de s'ouvrir en accusant le répertoire
   * plutôt que la variable. Il doit exister et être inscriptible : le site ne le
   * crée pas, il refuse de démarrer.
   */
  DATA_DIR: required('DATA_DIR').refine(
    isAbsolute,
    'DATA_DIR doit être un chemin absolu (voir .env.example)'
  ),
  /** URL publique du site. */
  NEXT_PUBLIC_SITE_URL: z.url({
    // Restreint à http/https : `z.url()` seul accepterait `javascript:` ou `data:`.
    protocol: /^https?$/,
    error: 'NEXT_PUBLIC_SITE_URL doit être une URL absolue en http ou https (voir .env.example)'
  }),
  /** Interface d'écoute — Caddy est la seule porte publique (AD-10). */
  HOSTNAME: z.string().min(1, 'HOSTNAME ne doit pas être vide').default('127.0.0.1'),
  /** Port d'écoute local. */
  PORT: z.coerce
    .number({error: 'PORT doit être un entier'})
    .int('PORT doit être un entier')
    .min(1, 'PORT doit être compris entre 1 et 65535')
    .max(65535, 'PORT doit être compris entre 1 et 65535')
    .default(3000),
  /** Développement uniquement : sert /admin en local (AD-10). */
  ADMIN_DEV: z
    .enum(['0', '1'], {error: "ADMIN_DEV doit valoir '0' ou '1'"})
    .default('0')
    .transform((value) => value === '1')
});

export type Env = z.infer<typeof envSchema>;

/** Source de configuration : `process.env` ou, dans les tests, un objet équivalent. */
export type EnvSource = Record<string, string | undefined>;

/** Clés dont une valeur vide équivaut à une absence : la valeur par défaut s'applique. */
const OPTIONAL_KEYS = ['ANTHROPIC_BASE_URL', 'HOSTNAME', 'PORT', 'ADMIN_DEV'] as const;

/**
 * Valide une source d'environnement et renvoie la configuration typée.
 * Lève une `Error` dont le message nomme chaque variable fautive.
 */
export function parseEnv(source: EnvSource = process.env): Env {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = source[key];
    const blank = value === undefined || value === '';
    raw[key] = blank && (OPTIONAL_KEYS as readonly string[]).includes(key) ? undefined : value;
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration d'environnement invalide :\n${details}`);
  }
  return result.data;
}

/** Configuration validée au chargement du module — le démarrage échoue si elle est invalide. */
export const env: Env = parseEnv();
