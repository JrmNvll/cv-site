/**
 * Le branchement du journal sur la requête — AD-14, côté `app`.
 *
 * `proxy.ts` pose les cookies et n'ouvre jamais la base ; `journal` ouvre la
 * base et ne lit jamais la requête. Entre les deux, ce module : il lit les
 * cookies — les deux de visite, et le relais `cv_label` quand il y en a un
 * (story 12) —, l'adresse (`clientIp`, AD-15), le navigateur, la provenance, et
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
import {cookies, headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {hasLocale} from 'next-intl';
import {routing, type Locale} from '@/i18n/routing';
import {clientIp} from '@/lib/client-ip';
import {isUlid} from '@/lib/ulid';
import {isVisitLabel, LABEL_COOKIE, SESSION_COOKIE, VISITOR_COOKIE} from '@/lib/visit-cookies';
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
 * L'étiquette du lien portée par le cookie relais `cv_label`, posé par
 * `proxy.ts` à l'arrivée d'un `?l=` valide (story 12) — ou `null`.
 *
 * Revalidée ici : un cookie n'est pas plus digne de confiance qu'une chaîne de
 * requête, et le libellé entre dans la base. `touchSession()` ne la pose qu'à
 * la **création** de la session ; `proxy.ts` efface le cookie sur la même
 * réponse, l'étiquette ne vaut donc que pour cette visite.
 */
export function visitLabel(cookies: CookieReader): string | null {
  const value = cookies.get(LABEL_COOKIE)?.value;
  return isVisitLabel(value) ? value : null;
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
export type RecordedVisit = TouchSessionResult &
  VisitIds & {
    readonly ip: string;
    /**
     * Vrai si cette visite est écartée (story 13) : son adresse ou son cookie
     * de visiteur est bloqué. Un booléen, et non le détail des deux clés — ce
     * détail est l'affaire de l'admin, qui interroge le journal directement ;
     * ici, chaque appelant n'a qu'une décision à prendre, et elle est la même.
     *
     * La visite est **quand même** journalisée : AD-7 garde tout, et
     * l'insistance de quelqu'un qu'on a écarté est une information. Ce qui
     * change, c'est ce qu'on lui sert.
     */
    readonly blocked: boolean;
  };

/**
 * Le test de fumée ne se journalise pas (décision de Jérémie, 2026-09-22) : il
 * tourne contre l'URL réelle après chaque déploiement, une vingtaine de
 * requêtes à chaque fois, et ses visites fausseraient le journal, ses
 * compteurs et la mesure du bruit des robots. Son agent utilisateur est posé
 * par `playwright.smoke.config.ts` et n'appartient à aucun navigateur.
 *
 * Conséquence assumée : une requête qui se présente ainsi n'a ni session ni
 * échange — et l'assistant lui répond `no_visitor`, puisque `recordVisit`
 * rend `null`. Usurper cet agent utilisateur ne donne donc rien de plus que
 * de refuser les cookies : on n'est pas journalisé, on n'a pas l'assistant.
 */
const SMOKE_USER_AGENT = /^cv-site-smoke\//;

/**
 * Ce qu'une route sert à un visiteur bloqué (story 13) : un `404` **nu**.
 *
 * Aucun code du contrat (`chat-contract.ts`) ne nomme le blocage, et il ne
 * faut pas en créer : le panneau afficherait le message correspondant, et le
 * bloqué saurait. Aucun corps, aucun en-tête propre — rien qui distingue cette
 * réponse de celle d'une route qui n'existe pas.
 */
/**
 * Les cookies lus dans l'en-tête, pour un appelant qui n'a qu'un `Request` nu —
 * `/api/photo`, qui ne passe pas par `NextRequest`. Nos valeurs sont des ULID :
 * pas de guillemets, pas de pourcentage à décoder, rien d'autre à traiter que
 * le découpage. Une clé en double rend la première, comme un navigateur.
 */
export function cookieReaderOf(headers: Headers): CookieReader {
  const paires = new Map<string, string>();
  for (const morceau of (headers.get('cookie') ?? '').split(';')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;
    const nom = morceau.slice(0, separateur).trim();
    if (nom !== '' && !paires.has(nom)) paires.set(nom, morceau.slice(separateur + 1).trim());
  }
  return {get: (name) => (paires.has(name) ? {value: paires.get(name)!} : undefined)};
}

export function blockedResponse(): Response {
  // `private, no-store`, comme toute réponse du site : un `404` sans directive
  // de cache serait retenu par un intermédiaire selon ses heuristiques, puis
  // resservi — à un visiteur non bloqué, ou au bloqué après une levée.
  return new Response(null, {status: 404, headers: {'Cache-Control': 'private, no-store'}});
}

/**
 * La requête courante est-elle celle d'un bloqué ? — pour les **routes**, qui
 * rendent un `404` nu plutôt que de lever (`blockedResponse()`).
 *
 * `visit` est ce que `recordVisit()` a rendu, quand l'appelant l'a appelé :
 * son verdict fait foi, il est déjà calculé. Mais `recordVisit()` rend `null`
 * **sans cookies** — et c'est là le piège : une route appelée sans cookie
 * n'était alors jamais écartée, et il suffisait d'effacer ses cookies pour
 * récupérer les réponses du premier écran, la photo et le numéro de téléphone.
 * L'adresse, elle, tient toujours : on la consulte seule dans ce cas.
 *
 * Le test de fumée sort avant tout, comme partout : un déploiement ne doit pas
 * pouvoir se fermer tout seul. Et si le registre est illisible, la requête
 * passe — même arbitrage qu'AD-14, assumé et dit dans le README.
 */
export async function requestBlocked(
  request: {readonly cookies?: CookieReader; readonly headers: Headers},
  visit: RecordedVisit | null
): Promise<boolean> {
  if (visit !== null) return visit.blocked;
  if (SMOKE_USER_AGENT.test(request.headers.get('user-agent') ?? '')) return false;

  try {
    const {blockVerdict, isBlocked} = await import('@/journal');
    const jar = request.cookies ?? cookieReaderOf(request.headers);
    return isBlocked(
      blockVerdict({ip: clientIp(request.headers), visitorId: visitIds(jar)?.visitorId ?? null})
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'block.check_failed',
        reason: error instanceof Error ? error.message : String(error),
        text: "Le registre des blocages n'a pas pu être lu ; la requête est servie."
      })
    );
    return false;
  }
}

/**
 * Écarte la requête courante si son auteur est bloqué (story 13) : `notFound()`
 * — la page des URL inconnues, statut et corps compris. Appelée **en tête de
 * chaque page** du site.
 *
 * Pourquoi dans les pages et non dans le layout, qui journalise déjà : un
 * `notFound()` levé par le layout `(site)` chercherait sa frontière dans
 * `(site)/not-found.tsx`, qui est son propre **enfant** ; Next remonte alors
 * au-dessus, où il n'y a pas de layout racine, et ne sert qu'une coquille que
 * le navigateur doit remplir — donc rien sans JavaScript
 * (`src/app/global-not-found.tsx` le documente). Levé par une page, le layout
 * a réussi : la frontière se rend **dedans**, et le document est complet.
 *
 * Le prix est une seconde lecture des cookies et une requête indexée de plus
 * par document. `tests/unit/blocage-pages.test.ts` vérifie qu'aucune page du
 * site n'oublie cet appel — c'est ce qui rend le dispositif fiable malgré sa
 * répétition.
 */
export async function requireNotBlocked(): Promise<void> {
  const [cookieJar, requestHeaders] = await Promise.all([cookies(), headers()]);
  // Le test de fumée sort d'abord, comme dans `recordVisit` : il tourne après
  // chaque déploiement, et un blocage ne doit **jamais** pouvoir le faire
  // échouer — ce serait un déploiement qui se ferme tout seul. Il n'a de toute
  // façon pas de cookie à lui, mais il pourrait en hériter d'un contexte
  // partagé, et c'est arrivé en écrivant ce test.
  if (SMOKE_USER_AGENT.test(requestHeaders.get('user-agent') ?? '')) return;

  try {
    const {blockVerdict, isBlocked} = await import('@/journal');
    // Sans cookie, l'adresse est consultée **seule** : le proxy en pose un sur
    // chaque document, mais ne rien consulter du tout rouvrirait la porte à qui
    // les refuse ou les efface, et c'est l'adresse qui est censée le retenir.
    const verdict = blockVerdict({
      ip: clientIp(requestHeaders),
      visitorId: visitIds(cookieJar)?.visitorId ?? null
    });
    if (!isBlocked(verdict)) return;
  } catch (error) {
    // Journal injoignable : on sert la page. Le même arbitrage qu'AD-14 —
    // observer ne conditionne pas —, et le défaut de prudence est assumé.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'block.check_failed',
        reason: error instanceof Error ? error.message : String(error),
        text: "Le registre des blocages n'a pas pu être lu ; la page est servie."
      })
    );
    return;
  }
  notFound();
}

export async function recordVisit(request: VisitRequest): Promise<RecordedVisit | null> {
  if (SMOKE_USER_AGENT.test(request.headers.get('user-agent') ?? '')) return null;
  const ids = visitIds(request.cookies);
  if (ids === null) return null;
  const ip = clientIp(request.headers);

  try {
    const {blockVerdict, isBlocked, touchSession} = await import('@/journal');
    // Le verdict **avant** d'écrire : si la base est injoignable, le `catch`
    // ci-dessous rend `null` et la page est servie — un journal en panne ne
    // doit pas fermer le site, pas plus qu'il ne doit l'ouvrir à un bloqué.
    // C'est le même arbitrage qu'AD-14 fait pour la journalisation, et il
    // penche du même côté : observer ne conditionne pas, mais ici le défaut
    // de prudence est assumé et dit à voix haute dans le README.
    const blocked = isBlocked(blockVerdict({ip, visitorId: ids.visitorId}));
    const label = visitLabel(request.cookies);
    const result = touchSession({
      ...ids,
      ip,
      userAgent: bounded(request.headers.get('user-agent')),
      referer: provenance(request.headers.get('referer')),
      lang: request.lang,
      label
    });
    if (label !== null && result.outcome !== 'created') {
      // L'étiquette colle à la session et n'est posée qu'à sa création : une
      // arrivée par un lien alors qu'une session est déjà ouverte n'est donc
      // **pas** écrite, et `proxy.ts` efface le relais sur cette même réponse.
      // C'est voulu pour la base — mais l'arrivée serait alors invisible : une
      // ligne la rend lisible dans les journaux, sans toucher à la base. Le
      // libellé est borné et restreint, il n'y a rien à échapper ici.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'visit.label_dropped',
          sessionId: ids.sessionId,
          label,
          outcome: result.outcome,
          text: "Arrivée par un lien étiqueté sur une session déjà ouverte : l'étiquette d'origine est conservée, celle-ci n'est pas écrite."
        })
      );
    }
    return {...result, ...ids, ip, blocked};
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
