/**
 * `POST /admin/api/visiteurs/<ulid>` — nommer et annoter un visiteur (AD-7 :
 * `visitor.name`, `visitor.note`). Champs `name`, `note`, `from` ; la
 * mécanique — méthode, type, origine, bornes, `303` — vit dans
 * `mutation-route.ts`. Un identifiant qui n'est pas un ULID, ou un visiteur
 * inconnu, vaut `404`.
 *
 * `@/journal` est importé **à l'appel** : il entraîne `@/env`, dont le
 * parsage a lieu au chargement, et le build ne doit réclamer aucune variable.
 */
import type {NextRequest} from 'next/server';
import {isUlid} from '@/lib/ulid';
import {mutationRoute} from '../../../_lib/mutation-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, {params}: {params: Promise<{id: string}>}): Promise<Response> {
  const {id} = await params;
  const {setVisitor, VISITOR_NAME_MAX, VISITOR_NOTE_MAX} = await import('@/journal');
  return mutationRoute(request, {
    fields: [
      {name: 'name', max: VISITOR_NAME_MAX},
      {name: 'note', max: VISITOR_NOTE_MAX}
    ],
    apply: async ({name, note}) => (isUlid(id) && setVisitor({id, name, note}) ? 'ok' : 'not_found')
  });
}
