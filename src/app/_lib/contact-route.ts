/**
 * Ce que les routes « à la demande » ont en commun — AD-8, côté `app`.
 *
 * Le numéro et le courriel de Jérémie, les coordonnées d'une référence : trois
 * routes, une seule règle. La valeur n'est jamais rendue côté serveur ; elle
 * part en JSON après un geste explicite, en `no-store` pour qu'il n'en reste
 * rien dans un cache, fût-il privé ; et le geste prolonge la session du
 * visiteur qui présente ses cookies (AD-14) — sans cookies, la route répond
 * exactement pareil et n'écrit rien.
 *
 * `read` est appelé **après** le journal et **à la requête** : c'est là que la
 * route importe `@/content`, jamais au chargement du module (voir
 * `api/photo/route.ts`).
 */
import type {NextRequest} from 'next/server';
import {localeOfReferer, recordVisit} from './visit';

const HEADERS = {'Cache-Control': 'private, no-store'};

/** Ce qu'une route à la demande peut rendre ; une clé absente n'est pas envoyée. */
export type RevealedContact = {
  readonly telephone?: string | null;
  readonly email?: string | null;
};

export async function contactRoute(
  request: NextRequest,
  read: () => Promise<RevealedContact | null>
): Promise<Response> {
  await recordVisit({
    cookies: request.cookies,
    headers: request.headers,
    lang: localeOfReferer(request.headers.get('referer'), request.headers.get('host'))
  });

  const contact = await read();
  const body = {
    ...(contact?.telephone ? {telephone: contact.telephone} : {}),
    ...(contact?.email ? {email: contact.email} : {})
  };
  // `cv.yaml` peut ne pas déclarer la coordonnée : le bouton dira
  // l'indisponibilité, et LinkedIn reste à côté.
  if (Object.keys(body).length === 0) {
    return Response.json({error: 'absent'}, {status: 404, headers: HEADERS});
  }
  return Response.json(body, {headers: HEADERS});
}
