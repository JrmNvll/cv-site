/**
 * Proxy applicatif (Next 16 remplace `middleware.ts` par `proxy.ts`).
 *
 * Deux responsabilités, dans cet ordre :
 *  1. routage de langue next-intl (AD-5), sauf pour `/admin*` qui vit hors
 *     `[locale]` et n'est servi en développement que si `ADMIN_DEV=1` (AD-10) ;
 *  2. pose des cookies `cv_visitor` et `cv_session` (AD-14).
 *
 * L'ordre compte : le routage produit d'abord la réponse (redirection, réécriture
 * ou passage), **puis** les cookies sont posés dessus. Les poser avant les
 * perdrait sur une redirection.
 *
 * C'est le **seul** endroit de l'application qui pose un cookie.
 */
import {NextResponse, type NextRequest} from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import {env} from '@/env';
import {routing} from '@/i18n/routing';
import {isUlid, ulid} from '@/lib/ulid';
import {SESSION_COOKIE, VISITOR_COOKIE} from '@/lib/visit-cookies';

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * `cv_visitor` : un ULID, 400 jours ; `cv_session` : un ULID + horodatage de
 * dernière activité (AD-14). Les noms vivent dans `src/lib/visit-cookies.ts`,
 * que le layout lit aussi sans avoir à charger ce module.
 */
export {SESSION_COOKIE, VISITOR_COOKIE};
/** 400 jours, en secondes — plafond accepté par les navigateurs. */
export const VISITOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Au-delà, la session est close et un nouveau `cv_session` est posé. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Toute réponse portant un cookie de visite est propre à un visiteur. */
export const CACHE_CONTROL_VISIT = 'private, no-store';

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

/** `/admin` et tout ce qui est dessous vivent hors du routage de langue (AD-10). */
function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * En production, `/admin*` est servi et protégé par le `basic_auth` de Caddy.
 * En développement, il n'existe que si `ADMIN_DEV=1` — sinon 404, comme s'il
 * n'était pas déployé.
 */
function isAdminServed(): boolean {
  return env.ADMIN_DEV || process.env.NODE_ENV === 'production';
}

export default function proxy(request: NextRequest): NextResponse {
  const {pathname} = request.nextUrl;

  const response = isAdminPath(pathname)
    ? isAdminServed()
      ? NextResponse.next()
      : new NextResponse(null, {status: 404})
    : handleI18nRouting(request);

  return attachVisitCookies(request, response);
}

export const config = {
  // Requêtes de document uniquement : ni les ressources internes de Next, ni les
  // route handlers (une route handler sans cookie répond `no_visitor`, AD-6),
  // ni les fichiers statiques (reconnus à leur extension).
  matcher: ['/((?!api/|_next/|_vercel/|.*\\..*).*)']
};
