/**
 * `POST /admin/api/blocages/<session>` — bloquer l'auteur d'une session
 * (story 13), sur ses **deux** clés d'un seul geste : l'adresse de la session
 * et son cookie de visiteur. La mécanique vit dans `mutation-route.ts`.
 *
 * La session donne les deux valeurs : c'est elle que Jérémie a sous les yeux
 * quand il décide, et son identifiant est conservé avec le blocage (`from_session`)
 * pour retrouver plus tard ce qui l'a motivé. Une session inconnue vaut `404`,
 * un identifiant qui n'est pas un ULID vaut `400`.
 *
 * Une adresse qui ne désigne personne — `dev`, `unknown`, que portent les
 * sondes de santé de `deploy.ps1` — n'est **pas** bloquée ; le cookie l'est
 * seul, et la fiche de session le dit. Bloquer `unknown` fermerait le site à
 * chaque déploiement.
 *
 * `@/journal` est importé **à l'appel** (voir `visiteurs/[id]/route.ts`).
 */
import type {NextRequest} from 'next/server';
import {mutationRoute} from '../../../_lib/mutation-route';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  {params}: {params: Promise<{session: string}>}
): Promise<Response> {
  const sessionId = (await params).session;
  const {block, findSession} = await import('@/journal');
  const {isUlid} = await import('@/lib/ulid');
  return mutationRoute(request, {
    fields: [],
    apply: async () => {
      if (!isUlid(sessionId)) return 'invalid';
      const session = findSession(sessionId);
      if (session === undefined) return 'not_found';
      block({ip: session.ip, visitorId: session.visitorId, fromSession: sessionId});
      return 'ok';
    }
  });
}
