/**
 * Les coordonnées d'une référence, à la demande — AD-8, amendé le 2026-09-15.
 *
 * La page affiche le nom et la fonction d'une référence, rien de plus ; son
 * courriel et son numéro n'apparaissent ni dans le HTML servi ni dans le
 * contexte du modèle. Ils ne sont envoyés qu'après un geste explicite du
 * visiteur, et insérés côté client (`_components/contact-reveal.tsx`) — la
 * même règle que pour le numéro de Jérémie (`api/contact/phone`), pour des
 * données qui, elles, sont celles d'un tiers : l'accord de la personne est un
 * préalable au contenu, pas quelque chose que le code peut vérifier.
 *
 * `no-store` : rien ne doit rester de ces coordonnées dans un cache, fût-il
 * privé.
 */
import type {NextRequest} from 'next/server';
import {localeOfReferer, recordVisit} from '@/app/_lib/visit';

/**
 * Jamais rendue au build. `force-dynamic` ne suffit pas : Next charge le module
 * pour en lire les exports, et un `import` statique de `@/content` entraînerait
 * `@/env`, dont le parsage a lieu au chargement — le build réclamerait une clé
 * API. D'où un import dynamique **dans** la fonction, comme pour la photo
 * (voir `api/photo/route.ts`).
 */
export const dynamic = 'force-dynamic';

const HEADERS = {'Cache-Control': 'private, no-store'};

/** La forme d'un identifiant stable du contrat de contenu — rien d'autre n'est cherché. */
const REFERENCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(
  request: NextRequest,
  {params}: {params: Promise<{id: string}>}
): Promise<Response> {
  const {id} = await params;
  // Une adresse illégitime ne coûte ni une lecture du contenu ni une écriture
  // au journal.
  if (!REFERENCE_ID.test(id)) {
    return Response.json({error: 'inconnue'}, {status: 404, headers: HEADERS});
  }

  // Un geste réel du visiteur : sa session est prolongée s'il présente ses
  // cookies (AD-14), comme pour le téléphone.
  await recordVisit({
    cookies: request.cookies,
    headers: request.headers,
    lang: localeOfReferer(request.headers.get('referer'), request.headers.get('host'))
  });

  const {referenceContact} = await import('@/content');
  const contact = referenceContact(id);
  // Référence inconnue, ou sans coordonnée dans `cv.yaml` : la page n'a pas
  // proposé de bouton, mais la route le dit aussi clairement.
  if (contact === null) {
    return Response.json({error: 'inconnue'}, {status: 404, headers: HEADERS});
  }
  return Response.json(
    {
      ...(contact.telephone === null ? {} : {telephone: contact.telephone}),
      ...(contact.email === null ? {} : {email: contact.email})
    },
    {headers: HEADERS}
  );
}
