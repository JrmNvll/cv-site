/**
 * Le courriel, à la demande — AD-8, amendé le 2026-09-15.
 *
 * Jusqu'ici en clair dans l'en-tête, le courriel suit désormais la règle du
 * numéro : hors de la projection d'affichage, jamais dans le HTML servi, envoyé
 * après un geste explicite et inséré côté client. Le modèle, lui, le connaît
 * toujours (projection `agent`) : un recruteur qui le demande à l'assistant
 * l'obtient. Ce que la page refuse, c'est le moissonnage — pas la question.
 */
import type {NextRequest} from 'next/server';
import {contactRoute} from '@/app/_lib/contact-route';

/** Jamais rendue au build — même raison que `api/contact/phone/route.ts`. */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return contactRoute(request, async () => {
    const {contactEmail} = await import('@/content');
    return {email: contactEmail()};
  });
}
