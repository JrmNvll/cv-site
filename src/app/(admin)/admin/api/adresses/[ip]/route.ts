/**
 * `POST /admin/api/adresses/<ip>` — étiqueter une adresse (AD-7 : `ip_label`,
 * la troisième chose que l'admin écrit). Champs `label`, `from` ; la
 * mécanique vit dans `mutation-route.ts`. L'adresse est celle du segment,
 * telle que `clientIp()` l'a rendue au journal — IPv4, IPv6, `dev` ou
 * `unknown` ; tout le reste vaut `400`. L'étiquette porte sur **toutes** les
 * sessions de cette adresse, passées et futures.
 *
 * `@/journal` est importé **à l'appel** (voir `visiteurs/[id]/route.ts`).
 */
import type {NextRequest} from 'next/server';
import {mutationRoute} from '../../../_lib/mutation-route';

export const dynamic = 'force-dynamic';

/**
 * Next fournit le segment **déjà décodé** (`2001:db8::1` pour `2001%3Adb8%3A%3A1`
 * dans l'URL) ; ce décodage n'est qu'une tolérance, pour un appelant qui
 * passerait le segment encodé — il ne change rien à une adresse ordinaire.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function POST(request: NextRequest, {params}: {params: Promise<{ip: string}>}): Promise<Response> {
  const ip = decodeSegment((await params).ip);
  const {isJournalIp, setIpLabel, IP_LABEL_MAX} = await import('@/journal');
  return mutationRoute(request, {
    fields: [{name: 'label', max: IP_LABEL_MAX}],
    apply: async ({label}) => {
      if (!isJournalIp(ip)) return 'invalid';
      setIpLabel({ip, label});
      return 'ok';
    }
  });
}
