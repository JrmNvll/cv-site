/**
 * `POST /api/match` — une annonce collée, évaluée par le modèle, en flux
 * (CAP-4, AD-16, AD-17).
 *
 * Même mécanique que `/api/chat` (`src/app/_lib/stream-route.ts`) : corps
 * borné, visite, refus en JSON, flux SSE, battement de cœur — mêmes statuts,
 * mêmes événements. Ce qui change : la borne du corps, l'analyse de
 * `{ad, lang}`, et l'appel à `agent.match()` par un import **différé** —
 * `agent` charge `@/env`, dont le parsage a lieu au chargement, et le build ne
 * doit réclamer aucune variable. Ce que le navigateur reçoit ne porte jamais
 * une marque `[qa:…]` ni un bloc `<sources>` : retenus côté serveur.
 */
import type {NextRequest} from 'next/server';
import {parseMatchRequest, type MatchRequest} from '@/app/_lib/chat-contract';
import {streamRoute} from '@/app/_lib/stream-route';

export {HEARTBEAT_MS} from '@/app/_lib/stream-route';

/** Jamais rendue au build (voir `api/questions/[id]/route.ts`). */
export const dynamic = 'force-dynamic';

/**
 * Une annonce tient en huit mille caractères ; un corps JSON qui les porte
 * tient en 48 Kio — des **octets** UTF-8, comme `Content-Length` les compte,
 * échappements `\uXXXX` compris (six octets chacun, huit mille fois : 48 000).
 * Au-delà, ce n'est pas une annonce, et rien n'est analysé — ni lu, quand
 * `Content-Length` le dit d'avance.
 */
export const BODY_MAX_BYTES = 48 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  return streamRoute<MatchRequest>(request, {
    bodyMaxBytes: BODY_MAX_BYTES,
    parse: parseMatchRequest,
    failedEvent: 'agent.match_failed',
    call: async (body, visit) => {
      const {match} = await import('@/agent');
      return match({...visit, ad: body.ad});
    }
  });
}
