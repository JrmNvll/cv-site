/**
 * Le branchement du journal sur la requête — AD-14, côté `app`.
 *
 * `proxy.ts` pose les cookies et n'ouvre jamais la base ; `journal` ouvre la
 * base et ne lit jamais la requête. Entre les deux, ce module : il lit les deux
 * cookies, l'adresse (`clientIp`, AD-15), le navigateur, la provenance, et
 * passe le tout à `touchSession()`. Plusieurs appelants, le même geste : la
 * racine du **site** (`src/app/(site)/layout.tsx`), qui voit tout document du
 * site ; la 404 globale (`src/app/global-not-found.tsx`), pour toute URL sans
 * route ; et les routes d'un geste réel du visiteur (les coordonnées, une
 * question). La racine de l'admin ne l'appelle jamais. Une sonde à extension
 * — `/wp-login.php`, `/.env` — arrive à la 404 globale mais **sans être
 * passée par le proxy** : sans cookie de visite, rien n'est appelé, rien
 * n'est écrit — ce n'est pas une visite.
 *
 * Sans cookies valides, rien n'est appelé : une requête `curl` sur une route
 * répond normalement et ne laisse aucune trace — le journal n'invente pas de
 * visiteur, c'est le proxy qui en crée, sur les documents.
 */
import {hasLocale} from 'next-intl';
import {routing, type Locale} from '@/i18n/routing';
import {clientIp} from '@/lib/client-ip';
import {isUlid} from '@/lib/ulid';
import {SESSION_COOKIE, VISITOR_COOKIE} from '@/lib/visit-cookies';
import type {TouchSessionResult} from '@/journal';

/**
 * Au-delà, un `User-Agent` ou un `Referer` n'est plus une information : c'est
 * du bruit, ou une charge que rien ne purgera jamais (AD-7).
 */
export const HEADER_MAX = 512;

/** Une valeur d'en-tête bornée ; vide ou absente vaut `null`. */
function bounded(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, HEADER_MAX);
}

/**
 * La provenance d'une visite : l'origine et le chemin du `Referer`, **sans**
 * sa chaîne de requête ni son fragment. Un site d'offres y met un identifiant
 * de suivi, parfois un courriel — rien que le journal ait à garder pour dire
 * d'où vient une visite. Une valeur qui n'est pas une URL est gardée telle
 * quelle, bornée.
 */
export function provenance(referer: string | null): string | null {
  const value = bounded(referer);
  if (value === null) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, HEADER_MAX);
  } catch {
    return value;
  }
}

/** Ce que `cookies()` de `next/headers` et `request.cookies` ont en commun. */
export type CookieReader = {
  get(name: string): {value: string} | undefined;
};

export type VisitIds = {
  readonly visitorId: string;
  readonly sessionId: string;
};

/**
 * Les identifiants portés par les cookies, ou `null` si l'un manque ou n'est
 * pas un ULID. `cv_session` vaut `<ulid>.<timestamp>` : seul l'identifiant
 * compte ici, l'horodatage est l'affaire du proxy.
 */
export function visitIds(cookies: CookieReader): VisitIds | null {
  const visitorId = cookies.get(VISITOR_COOKIE)?.value;
  const sessionId = cookies.get(SESSION_COOKIE)?.value.split('.')[0];
  return isUlid(visitorId) && isUlid(sessionId) ? {visitorId, sessionId} : null;
}

/**
 * La langue d'un appel de route, lue dans le `Referer` du `fetch` — la page CV
 * elle-même, `/fr` ou `/en`. Une route vit hors `[locale]` et le proxy ne la
 * voit pas : `getLocale()` y rendrait toujours la langue par défaut. La session
 * est normalement déjà créée par le layout, qui connaît la langue ; ceci ne
 * sert que si la route la crée, et vaut la langue par défaut à défaut.
 *
 * Seul un `Referer` de **notre** hôte compte : un site tiers dont le premier
 * segment de chemin vaut `en` ne dicte pas la langue d'une session.
 */
export function localeOfReferer(referer: string | null, host: string | null): Locale {
  if (referer === null || host === null) return routing.defaultLocale;
  try {
    const url = new URL(referer);
    if (url.host !== host) return routing.defaultLocale;
    const segment = url.pathname.split('/')[1];
    return hasLocale(routing.locales, segment) ? segment : routing.defaultLocale;
  } catch {
    return routing.defaultLocale;
  }
}

export type VisitRequest = {
  readonly cookies: CookieReader;
  readonly headers: Headers;
  readonly lang: string;
};

/**
 * Crée ou prolonge la session du visiteur — ou ne fait rien s'il n'en présente
 * pas. `@/journal` est importé **à l'appel**, comme `@/content` par les pages :
 * il entraîne `@/env`, dont le parsage a lieu au chargement, et le build ne
 * doit réclamer aucune variable.
 *
 * **Le journal observe la visite, il ne la conditionne pas.** Une base
 * verrouillée par un outil externe, un disque plein, une erreur d'E/S sont
 * dits — une ligne `journal.write_failed` — et la page est servie quand même.
 * L'échec au **démarrage**, lui, arrête le processus (`startup.ts`) : c'est
 * là qu'un `DATA_DIR` mal configuré doit être vu, pas à la première visite.
 */
/**
 * Ce que `recordVisit` a fait, pour quels identifiants et quelle adresse — une
 * seule lecture des cookies, une seule de l'adresse (AD-15) : l'agent reçoit
 * la même `ip` que le journal, sans relire la requête.
 */
export type RecordedVisit = TouchSessionResult & VisitIds & {readonly ip: string};

export async function recordVisit(request: VisitRequest): Promise<RecordedVisit | null> {
  const ids = visitIds(request.cookies);
  if (ids === null) return null;
  const ip = clientIp(request.headers);

  try {
    const {touchSession} = await import('@/journal');
    const result = touchSession({
      ...ids,
      ip,
      userAgent: bounded(request.headers.get('user-agent')),
      referer: provenance(request.headers.get('referer')),
      lang: request.lang
    });
    return {...result, ...ids, ip};
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'journal.write_failed',
        reason: error instanceof Error ? error.message : String(error),
        text: "La visite n'a pas été journalisée ; la page est servie quand même."
      })
    );
    return null;
  }
}
