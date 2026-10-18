/**
 * `POST /admin/api/blocages/lever` — lever **une** clé de blocage (story 13).
 *
 * Une clé à la fois, et c'est tout l'intérêt : un blocage porte sur l'adresse
 * **et** sur le cookie, mais une adresse partagée — opérateur mobile,
 * entreprise, VPN — emporte des innocents. On rouvre l'adresse en laissant le
 * cookie fermé, ou l'inverse.
 *
 * Lever **n'efface rien** (AD-7) : la ligne reste, datée de sa levée. Une clé
 * qui n'était pas bloquée vaut `404` — « rien à lever » n'est pas un succès,
 * et l'afficher comme tel masquerait un formulaire périmé.
 *
 * `@/journal` est importé **à l'appel** (voir `visiteurs/[id]/route.ts`).
 */
import type {NextRequest} from 'next/server';
import {mutationRoute} from '../../../_lib/mutation-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const {BLOCK_KINDS, BLOCK_VALUE_MAX, liftBlock} = await import('@/journal');
  return mutationRoute(request, {
    fields: [
      // La sorte tient dans « visitor » ; la valeur, dans la borne de la table.
      {name: 'kind', max: 16},
      {name: 'value', max: BLOCK_VALUE_MAX}
    ],
    apply: async ({kind, value}) => {
      const sorte = BLOCK_KINDS.find((candidate) => candidate === kind);
      if (sorte === undefined || value === '') return 'invalid';
      return liftBlock(sorte, value) > 0 ? 'ok' : 'not_found';
    }
  });
}
