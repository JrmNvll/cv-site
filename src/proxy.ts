/**
 * Proxy applicatif (Next 16 remplace `middleware.ts` par `proxy.ts`).
 *
 * Deux responsabilités, dans cet ordre :
 *  1. routage de langue next-intl (AD-5), sauf pour `/admin*` qui vit hors
 *     `[locale]` et n'est servi en développement que si `ADMIN_DEV=1` (AD-10) ;
 *  2. pose des cookies `cv_visitor` et `cv_session` (AD-14) — **sauf** sur
 *     `/admin*` : l'admin ne se journalise pas, il ne crée ni ne prolonge
 *     aucune session, et rien ne doit lui poser un cookie de visite. La
 *     réponse reste `private, no-store` : ce qu'elle montre est à Jérémie ;
 *  3. consommation de l'étiquette de lien `?l=<libellé>` (story 12) : validée,
 *     relayée par le cookie court `cv_label`, puis **retirée de l'adresse** par
 *     une redirection — le visiteur ne la voit jamais dans sa barre d'adresse.
 *     Toujours hors `/admin*`, qui ne consomme rien — mais y efface le relais,
 *     pour qu'un aller-retour par l'admin ne le laisse pas derrière lui ;
 *  4. sur toute réponse de document, dit si la requête portait une adresse
 *     de client valide (`X-Client-IP-Seen: 1` ou `0`, AD-15) — jamais la
 *     valeur. C'est la seule preuve automatique, après un déploiement, qu'un
 *     `header_up` mal orthographié dans le Caddyfile ne laisse pas un journal
 *     sans adresses : le test de fumée l'exige derrière le proxy.
 *
 * L'ordre compte : le routage produit d'abord la réponse (redirection, réécriture
 * ou passage), **puis** les cookies sont posés dessus. Les poser avant les
 * perdrait sur une redirection.
 *
 * C'est le **seul** endroit de l'application qui pose un cookie.
 */
import {isIP} from 'node:net';
import {NextResponse, type NextRequest} from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import {env} from '@/env';
import {routing} from '@/i18n/routing';
import {isAdminServed} from '@/lib/admin-served';
import {CLIENT_IP_HEADER} from '@/lib/client-ip';
import {isUlid, ulid} from '@/lib/ulid';
import {
  isVisitLabel,
  LABEL_COOKIE,
  LABEL_PARAM,
  SESSION_COOKIE,
  VISITOR_COOKIE
} from '@/lib/visit-cookies';

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * `cv_visitor` : un ULID, 400 jours ; `cv_session` : un ULID + horodatage de
 * dernière activité (AD-14). Les noms vivent dans `src/lib/visit-cookies.ts`,
 * que le layout lit aussi sans avoir à charger ce module.
 */
export {LABEL_COOKIE, LABEL_PARAM, SESSION_COOKIE, VISITOR_COOKIE};
/** Le code de la redirection qui retire `?l=` de l'adresse. */
export const LABEL_REDIRECT_STATUS = 302;
/** 400 jours, en secondes — plafond accepté par les navigateurs. */
export const VISITOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Au-delà, la session est close et un nouveau `cv_session` est posé. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Toute réponse portant un cookie de visite est propre à un visiteur — et l'admin l'est à Jérémie. */
export const CACHE_CONTROL_VISIT = 'private, no-store';
/**
 * `1` si la requête porte un `X-Client-IP` valide, `0` sinon — jamais la valeur
 * (AD-15). Même lecture que `clientIp()` (`isIP`), sans passer par elle : elle
 * journalise l'absence, et ce n'est pas le rôle du proxy.
 */
export const CLIENT_IP_SEEN_HEADER = 'X-Client-IP-Seen';

/**
 * Valeur du cookie de session : `<ulid>.<timestamp>`.
 *
 * L'horodatage de dernière activité voyage dans le cookie parce que `proxy.ts`
 * n'a pas accès au journal : la couche `journal` n'est pas encore atteignable
 * ici, et la convention veut qu'elle reste seule propriétaire de `usage.db`.
 */
export function nextSessionCookie(
  previous: string | undefined,
  now: number
): {value: string; sessionId: string; renewed: boolean} {
  const [id, seenAt] = (previous ?? '').split('.');
  const lastSeen = Number(seenAt);
  const alive =
    isUlid(id) && Number.isFinite(lastSeen) && lastSeen <= now && now - lastSeen <= SESSION_IDLE_MS;

  const sessionId = alive ? id : ulid(now);
  return {value: `${sessionId}.${now}`, sessionId, renewed: !alive};
}

/** Pose (ou reconduit) les deux cookies de visite sur la réponse déjà construite. */
function attachVisitCookies(request: NextRequest, response: NextResponse): NextResponse {
  const now = Date.now();

  const previousVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = isUlid(previousVisitor) ? previousVisitor : ulid(now);
  response.cookies.set({
    name: VISITOR_COOKIE,
    value: visitorId,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_MAX_AGE_SECONDS
  });

  const session = nextSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, now);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: session.value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/'
    // Sans `maxAge` : cookie de session, effacé à la fermeture du navigateur.
  });

  // Une réponse qui porte un identifiant de visiteur ne doit jamais être
  // retenue par un cache partagé en amont : elle serait resservie au visiteur
  // suivant, qui hériterait de l'identité du précédent.
  response.headers.set('Cache-Control', CACHE_CONTROL_VISIT);

  return response;
}

/** Ce qui expire `cv_label` : mêmes attributs que la pose, durée nulle. */
const CLEARED_LABEL_COOKIE = `${LABEL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/**
 * Pose le cookie relais sur la réponse qui redirige, ou l'efface sur la
 * réponse d'après.
 *
 * Effacé **par le proxy**, pas par le lecteur : `visit.ts` ne pose aucun
 * cookie (AD-14), et une étiquette qui survivrait à la requête suivante
 * contaminerait la visite d'après — une session ouverte le lendemain par une
 * adresse nue hériterait du libellé d'un courriel oublié. Sans `maxAge` : le
 * cookie ne doit pas survivre à la fermeture du navigateur non plus.
 */
function attachLabelCookie(
  request: NextRequest,
  response: NextResponse,
  label: string | null
): NextResponse {
  if (label !== null) {
    response.cookies.set({
      name: LABEL_COOKIE,
      value: label,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/'
    });
    return response;
  }
  if (request.cookies.has(LABEL_COOKIE)) {
    // En-tête **brut**, et non `response.cookies.set()` : Next relaie les
    // cookies posés par cette API dans la requête que voit la page — c'est ce
    // qui permet au layout de lire `cv_session` dès la première visite. Un
    // effacement par la même voie masquerait donc l'étiquette à `recordVisit`
    // sur la réponse même où il a lieu, et rien ne serait jamais écrit.
    // `Max-Age=0` sur le même chemin est ce que le navigateur reconnaît comme
    // une expiration ; les autres attributs sont ceux de la pose.
    response.headers.append('set-cookie', CLEARED_LABEL_COOKIE);
  }
  return response;
}

/**
 * Les méthodes pour lesquelles `?l=` est consommé. Une redirection `302`
 * dégrade la méthode et perd le corps : un `POST` étiqueté serait rejoué en
 * `GET`, sans ce qu'il portait. Aucune requête de document n'est un `POST`
 * aujourd'hui (le `matcher` exclut `api/`) — c'est une ligne de garde, pas une
 * correction : sur toute autre méthode, le paramètre est simplement ignoré.
 */
const LABEL_METHODS = new Set(['GET', 'HEAD']);

/**
 * Le libellé porté par l'adresse, s'il est acceptable — sinon `null`, et la
 * page est servie comme si le paramètre n'était pas là : pas de cookie, pas de
 * redirection, rien en base. Une valeur refusée ne mérite pas un message, elle
 * vient d'une adresse que n'importe qui a pu écrire.
 */
function labelOf(request: NextRequest): string | null {
  if (!LABEL_METHODS.has(request.method)) return null;
  const value = request.nextUrl.searchParams.get(LABEL_PARAM);
  return isVisitLabel(value) ? value : null;
}

/**
 * La redirection qui retire `?l=` de l'adresse, en **un seul saut**.
 *
 * Le routage de langue a déjà produit sa réponse : si c'est une redirection
 * (`/` → `/fr`), c'est sa cible qu'on nettoie et vers laquelle on renvoie —
 * sinon le visiteur passerait par `/`, puis `/fr`, deux adresses propres au
 * lieu d'une. Sinon, c'est l'adresse courante, moins le paramètre. Les autres
 * paramètres sont conservés : `?l=a7f3&utm_source=mail` mène à `?utm_source=mail`.
 *
 * **Dépendance nommée** : on ne garde de la réponse du routage que son
 * `Location`, donc tout ce qu'il poserait d'autre serait perdu. C'est sans
 * conséquence parce que `src/i18n/routing.ts` tient `localeCookie: false` (le
 * proxy est le seul à poser des cookies) et `localeDetection: false` (la racine
 * mène toujours à `/fr`, sans `Vary` ni négociation d'en-tête). Si l'une des
 * deux passait à `true`, il faudrait repartir de la réponse du routage et y
 * poser la redirection, au lieu de la reconstruire. `tests/unit/proxy.test.ts`
 * échoue si l'une des deux change.
 */
function labelRedirect(request: NextRequest, routed: NextResponse): NextResponse {
  const location = routed.headers.get('location');
  const target = new URL(location ?? request.nextUrl.toString(), request.nextUrl);
  target.searchParams.delete(LABEL_PARAM);
  return NextResponse.redirect(target, LABEL_REDIRECT_STATUS);
}

/** `/admin` et tout ce qui est dessous vivent hors du routage de langue (AD-10). */
function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** Pose `X-Client-IP-Seen` sur la réponse, d'après la requête. */
function attachClientIpSeen(request: NextRequest, response: NextResponse): NextResponse {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim() ?? '';
  response.headers.set(CLIENT_IP_SEEN_HEADER, value !== '' && isIP(value) !== 0 ? '1' : '0');
  return response;
}

export default function proxy(request: NextRequest): NextResponse {
  const {pathname} = request.nextUrl;

  if (isAdminPath(pathname)) {
    // En production, `/admin*` est servi et protégé par le `basic_auth` de
    // Caddy. En développement, il n'existe que si `ADMIN_DEV=1` — sinon 404,
    // comme s'il n'était pas déployé (`src/lib/admin-served.ts`, que les
    // routes de mutation relisent aussi).
    const response = isAdminServed(env) ? NextResponse.next() : new NextResponse(null, {status: 404});
    // Aucun cookie de visite : une visite de l'admin n'est pas une visite du
    // CV. Mais pas de cache partagé non plus — ce que l'admin montre est privé.
    // Un `?l=` n'y est ni consommé, ni relayé : l'admin ne se journalise pas.
    response.headers.set('Cache-Control', CACHE_CONTROL_VISIT);
    // Le relais, lui, est **effacé** ici aussi : Jérémie est précisément celui
    // qui clique ses propres liens puis va voir l'admin, et un `cv_label` qui
    // survivrait à ce détour étiquetterait une visite ultérieure sans rapport.
    // Rien d'autre n'est posé.
    return attachClientIpSeen(request, attachLabelCookie(request, response, null));
  }

  // Le routage de langue d'abord, dans tous les cas : c'est lui qui dit si
  // l'adresse propre est celle-ci ou une autre langue.
  const routed = handleI18nRouting(request);
  const label = labelOf(request);
  const response = label === null ? routed : labelRedirect(request, routed);

  return attachClientIpSeen(
    request,
    attachLabelCookie(request, attachVisitCookies(request, response), label)
  );
}

export const config = {
  // Requêtes de document uniquement : ni les ressources internes de Next, ni les
  // route handlers (une route handler sans cookie répond `no_visitor`, AD-6),
  // ni les fichiers statiques (reconnus à leur extension) — **plus** tout
  // `/admin*`, explicitement : `/admin/api/adresses/203.0.113.7` contient un
  // point et échapperait au premier motif, donc à la porte `ADMIN_DEV`.
  matcher: ['/((?!api/|_next/|_vercel/|.*\\..*).*)', '/admin/:path*']
};
