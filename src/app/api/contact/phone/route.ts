/**
 * Le numéro de téléphone, à la demande — AD-8.
 *
 * C'est l'une des exceptions délibérées aux deux projections : le numéro est
 * exclu de `display` comme de `agent`, donc il n'apparaît ni dans le HTML servi
 * ni dans le contexte du modèle. Il reste pourtant une coordonnée que Jérémie
 * publie — simplement, elle n'est envoyée qu'après un geste explicite du
 * visiteur, et insérée côté client (`_components/contact-reveal.tsx`). La
 * mécanique commune vit dans `app/_lib/contact-route.ts`.
 */
import type {NextRequest} from 'next/server';
import {contactRoute} from '@/app/_lib/contact-route';

/**
 * Jamais rendue au build. `force-dynamic` ne suffit pas : Next charge le module
 * pour en lire les exports, et un `import` statique de `@/content` entraînerait
 * `@/env`, dont le parsage a lieu au chargement — le build réclamerait une clé
 * API. D'où un import dynamique **dans** la fonction, comme pour la photo
 * (voir `api/photo/route.ts`).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return contactRoute(request, async () => {
    const {contactPhone} = await import('@/content');
    return {telephone: contactPhone()};
  });
}
