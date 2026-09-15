/**
 * Le numéro de téléphone, à la demande — AD-8.
 *
 * C'est **la seule exception** aux deux projections, et elle est délibérée : le
 * numéro est exclu de `display` comme de `agent`, donc il n'apparaît ni dans le
 * HTML servi ni dans le contexte du modèle. Il reste pourtant une coordonnée que
 * Jérémie publie — simplement, elle n'est envoyée qu'après un geste explicite du
 * visiteur, et insérée côté client (`_components/phone-reveal.tsx`).
 *
 * `no-store` : rien ne doit rester du numéro dans un cache, fût-il privé.
 */

/**
 * Jamais rendue au build. `force-dynamic` ne suffit pas : Next charge le module
 * pour en lire les exports, et un `import` statique de `@/content` entraînerait
 * `@/env`, dont le parsage a lieu au chargement — le build réclamerait une clé
 * API. D'où un import dynamique **dans** la fonction, comme pour la photo
 * (voir `api/photo/route.ts`).
 */
export const dynamic = 'force-dynamic';

const HEADERS = {'Cache-Control': 'private, no-store'};

export async function GET(): Promise<Response> {
  const {contactPhone} = await import('@/content');
  const telephone = contactPhone();
  // `cv.yaml` peut ne pas en déclarer : le bouton dira l'indisponibilité, et le
  // courriel reste à côté.
  if (telephone === null || telephone === '') {
    return Response.json({error: 'absent'}, {status: 404, headers: HEADERS});
  }
  return Response.json({telephone}, {headers: HEADERS});
}
