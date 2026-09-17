/**
 * La mécanique commune des mutations de l'admin — `POST /admin/api/*`.
 *
 * Deux routes (nommer un visiteur, étiqueter une adresse), une seule règle,
 * écrite une fois. Une mutation est un **formulaire HTML** vers une route
 * handler (AD-10 : aucune Server Action), qui répond par une redirection vers
 * la page d'origine — lisible et utilisable sans JavaScript.
 *
 * Dans l'ordre, et rien n'est écrit avant la fin :
 *  0. `404` si la porte de l'admin est fermée (développement sans
 *     `ADMIN_DEV`) — la même règle que le proxy, relue ici en ceinture ;
 *  1. `405` (`Allow: POST`) pour une autre méthode ; `415` pour un autre type
 *     de contenu qu'`application/x-www-form-urlencoded` ;
 *  2. `403` si l'origine est étrangère — `Sec-Fetch-Site` doit valoir
 *     `same-origin` ; sans cet en-tête (un vieux navigateur), `Origin` doit
 *     désigner l'hôte de la requête. C'est la seule chose que l'application
 *     ajoute à Caddy : le `basic_auth` rejoue les identifiants sur toute
 *     requête vers l'origine, une page tierce pourrait donc poster ici avec
 *     eux ;
 *  3. `400` si le corps dépasse `BODY_MAX_BYTES` (lu par morceaux, refusé dès
 *     la borne franchie), si un champ n'est pas un texte bien formé dans sa
 *     borne une fois ses invisibles retirés et ses bouts blancs ôtés, ou si
 *     `from` n'est pas un chemin de retour de l'admin (`isAdminReturnPath`) ;
 *  4. `400` si la cible n'est pas de la forme attendue (une adresse qui n'en
 *     est pas une), `404` si elle n'existe pas (un visiteur inconnu) — dits
 *     par `apply` ;
 *  5. `303` vers `from` une fois écrit.
 *
 * Tout est `private, no-store`. Les corps de refus sont du texte, en français.
 */
import type {NextRequest} from 'next/server';
import {isAdminServed} from '@/lib/admin-served';

/**
 * Au-delà, ce n'est pas un formulaire de l'admin. Une note de 2 000
 * caractères CJK pèse 6 000 octets en UTF-8 et 18 000 une fois
 * percent-encodée ; 64 Kio laissent de la marge sans rien charger d'énorme.
 */
export const BODY_MAX_BYTES = 64 * 1024;
export const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const HEADERS = {'Cache-Control': 'private, no-store'};

/**
 * Les invisibles qu'un `trim()` ne voit pas, et rien de plus : l'espace de
 * largeur nulle (U+200B), la marque d'ordre des octets (U+FEFF), le trait
 * d'union conditionnel (U+00AD) et les contrôles bidirectionnels
 * (U+202A–U+202E, U+2066–U+2069). **Pas** les antiliants et liants (U+200C,
 * U+200D) : un emoji composé ou un mot persan en ont besoin. Construits par
 * code plutôt qu'écrits en échappements, pour que rien ne les interprète.
 */
const c = (code: number) => String.fromCharCode(code);
const INVISIBLE_CHARS = new RegExp(
  `[${c(0x200b)}${c(0xfeff)}${c(0xad)}${c(0x202a)}-${c(0x202e)}${c(0x2066)}-${c(0x2069)}]`,
  'g'
);
/** Les caractères de commande C0 et C1, sauf la tabulation et les fins de ligne. */
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/**
 * Un texte de formulaire, normalisé : invisibles retirés, fins de ligne
 * ramenées à `\n`, blancs des bouts ôtés ; `null` s'il n'est pas bien formé
 * ou dépasse `max`. Vide est permis : c'est ainsi qu'on retire un nom.
 */
export function normalizeField(value: string | null, max: number): string | null {
  if (value === null) return '';
  const text = value.replace(INVISIBLE_CHARS, '').replace(CONTROL_CHARS, '').split(/\r\n|\r/).join('\n').trim();
  if (!text.isWellFormed() || text.length > max) return null;
  return text;
}

/**
 * Vrai si `from` est un chemin de retour de l'admin, et rien d'autre :
 * exactement `/admin`, `/admin?…` ou `/admin/…`, en ASCII imprimable
 * seulement (ni blanc, ni NUL, ni fin de ligne — rien qui puisse casser un
 * en-tête `Location`), sans segment `.` ni `..`, sans barre oblique inverse.
 * Vérifié **avant** d'écrire : un retour refusé après l'écriture laisserait
 * la mutation faite sans redirection.
 */
export function isAdminReturnPath(from: string): boolean {
  if (!/^\/admin(?:[?/][\x21-\x7e]*)?$/.test(from) || from.includes('\\')) return false;
  const path = from.split('?')[0]!;
  return !path.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * L'origine est-elle la nôtre ? `Sec-Fetch-Site` fait foi quand il est là :
 * tout navigateur courant l'envoie, et il ne se forge pas depuis une page.
 * Sans lui, `Origin` doit désigner l'hôte que le serveur a reçu — derrière
 * Caddy, `Host` est transmis tel quel. Sans l'un ni l'autre, non.
 */
export function isSameOrigin(headers: Headers): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite !== null) return fetchSite === 'same-origin';
  const origin = headers.get('origin');
  const host = headers.get('host');
  if (origin === null || host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type MutationField = {
  readonly name: string;
  /** La borne du journal pour ce champ, en caractères. */
  readonly max: number;
};

export type MutationOptions<Name extends string> = {
  readonly fields: readonly {readonly name: Name; readonly max: number}[];
  /**
   * L'écriture, une fois le corps vérifié : `ok` ; `not_found` si la cible
   * n'existe pas (`404`) ; `invalid` si la cible n'est pas de la forme
   * attendue (`400`) — rien n'est écrit dans ces deux cas.
   */
  readonly apply: (values: Readonly<Record<Name, string>>) => Promise<'ok' | 'not_found' | 'invalid'>;
};

function refuse(status: 400 | 403 | 404 | 405 | 415, text: string, extra: Record<string, string> = {}): Response {
  return new Response(`${text}\n`, {
    status,
    headers: {...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra}
  });
}

/**
 * Le corps, s'il tient dans la borne ; sinon `null`. `Content-Length` le dit
 * d'avance quand il est là ; sans lui, le flux est lu **par morceaux** et
 * abandonné dès que la borne est franchie — jamais tout chargé pour compter.
 */
export async function readForm(request: NextRequest): Promise<URLSearchParams | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return null;
  if (request.body === null) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > BODY_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export async function mutationRoute<Name extends string>(
  request: NextRequest,
  options: MutationOptions<Name>
): Promise<Response> {
  // La porte, relue ici : `@/env` est importé à l'appel, comme `@/journal`,
  // pour que le build ne réclame aucune variable.
  const {env} = await import('@/env');
  if (!isAdminServed(env)) return new Response(null, {status: 404, headers: HEADERS});

  if (request.method !== 'POST') return refuse(405, 'Méthode refusée : POST seulement.', {Allow: 'POST'});
  const contentType = request.headers.get('content-type')?.split(';')[0]!.trim().toLowerCase();
  if (contentType !== FORM_CONTENT_TYPE) {
    return refuse(415, `Corps refusé : ${FORM_CONTENT_TYPE} seulement.`);
  }
  if (!isSameOrigin(request.headers)) return refuse(403, 'Origine refusée.');

  const form = await readForm(request);
  if (form === null) return refuse(400, 'Corps invalide : trop long ou illisible.');
  const values = {} as Record<Name, string>;
  for (const field of options.fields) {
    const value = normalizeField(form.get(field.name), field.max);
    if (value === null) {
      return refuse(400, `Champ « ${field.name} » invalide : ${field.max} caractères au plus, texte bien formé.`);
    }
    values[field.name] = value;
  }
  const from = form.get('from') ?? '/admin';
  if (!isAdminReturnPath(from)) return refuse(400, 'Retour refusé : hors de l’administration.');

  const outcome = await options.apply(values);
  if (outcome === 'invalid') return refuse(400, 'Cible invalide.');
  if (outcome === 'not_found') return refuse(404, 'Introuvable.');
  return new Response(null, {status: 303, headers: {...HEADERS, Location: from}});
}
