/**
 * `POST /api/chat` — une question libre au modèle, en flux (CAP-3, AD-16).
 *
 * La mécanique — corps borné, visite, refus en JSON, flux SSE et battement de
 * cœur — vit dans `src/app/_lib/stream-route.ts`, partagée avec `/api/match`.
 * Ici ne restent que ce qui distingue cette route : la borne du corps,
 * l'analyse de `{question, lang}`, et l'appel à `agent.ask()` par un import
 * **différé** — `agent` charge `@/env`, dont le parsage a lieu au chargement,
 * et le build ne doit réclamer aucune variable.
 */
import type {NextRequest} from 'next/server';
import {parseChatRequest, type ChatRequest} from '@/app/_lib/chat-contract';
import {streamRoute} from '@/app/_lib/stream-route';

export {HEARTBEAT_MS} from '@/app/_lib/stream-route';

/** Jamais rendue au build (voir `api/questions/[id]/route.ts`). */
export const dynamic = 'force-dynamic';

/**
 * Une question tient en mille caractères ; un corps JSON qui les porte tient
 * en quelques kilo-octets. Au-delà, ce n'est pas une question, et rien n'est
 * analysé — ni lu, quand `Content-Length` le dit d'avance.
 */
export const BODY_MAX_BYTES = 8192;

export async function POST(request: NextRequest): Promise<Response> {
  return streamRoute<ChatRequest>(request, {
    bodyMaxBytes: BODY_MAX_BYTES,
    parse: parseChatRequest,
    failedEvent: 'agent.ask_failed',
    call: async (body, visit) => {
      const {ask} = await import('@/agent');
      return ask({...visit, question: body.question});
    }
  });
}
