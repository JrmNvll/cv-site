/**
 * La mécanique commune de `POST /api/chat` et `POST /api/match` (AD-16) : le
 * corps borné, la visite, les refus, le flux SSE et son battement de cœur.
 * Les deux routes ne diffèrent que par l'analyse du corps, la borne, et la
 * fonction de l'agent qu'elles appellent — c'est ce qu'elles passent ici.
 *
 * La route **orchestre** et ne fait rien d'autre : elle lit le corps, vérifie
 * la visite, appelle l'agent et met ses événements en SSE. Elle n'assemble
 * aucun contexte, ne choisit aucune entrée, ne nomme jamais l'API du modèle —
 * c'est la couche `agent`, que la route atteint par un import **différé**
 * dans son gestionnaire (l'import dynamique vit dans la route, pas ici) :
 * `agent` charge `@/env`, dont le parsage a lieu au chargement, et le build
 * ne doit réclamer aucune variable. Ce module n'importe de `@/agent` qu'un
 * type.
 *
 * Refus **préalables**, en JSON, dans cet ordre (AD-16) :
 *  - `400 invalid_input` — corps trop long (au-delà de `bodyMaxBytes`, dit
 *    par `Content-Length` ou constaté à la lecture), non JSON, texte vide ou
 *    trop long, langue hors du routage : rien n'est lu ni écrit ;
 *  - `401 no_visitor` — pas de cookies valides, ou session d'un autre visiteur
 *    (`mismatch`) : rien n'est écrit ;
 *  - `429 rate_limited`, `503 cap_reached`, `503 model_unavailable` — rendus
 *    par l'agent ; seul `cap_reached` laisse une ligne en base.
 *
 * Flux ouvert : `200 text/event-stream`, `delta {text}` au fil de l'eau — sans
 * jamais le bloc `<sources>` ni une marque, retirés côté serveur —, puis
 * `done {sources, exchangeId}` ou `error {reason}`. Tant que l'agent n'a rien
 * produit — la réflexion du modèle précède son premier mot —, un **battement
 * de cœur** (un commentaire SSE `: ping`) part toutes les dix secondes : le
 * navigateur remet son délai de silence à zéro sur tout octet reçu. **Le
 * client peut partir** : la route cesse d'écrire, l'agent va à son terme et
 * finalise l'échange (AD-6).
 *
 * Une exception hors contrat de l'agent — import différé qui échoue, panne
 * du limiteur ou de l'index — est un `503 model_unavailable` en JSON, dite
 * par la ligne que la route nomme (`agent.ask_failed`, `agent.match_failed`),
 * jamais un 500 muet.
 *
 * `no-store` : un flux personnel, rien à mettre en cache.
 */
import {hasLocale} from 'next-intl';
import type {NextRequest} from 'next/server';
import type {AskResult} from '@/agent';
import {routing, type Locale} from '@/i18n/routing';
import {CHAT_REFUSAL_STATUS, formatSseEvent, type ChatRefusal, type ChatRefusalReason} from './chat-contract';
import {recordVisit, visitIds} from './visit';

/** Le battement de cœur, tant que l'agent n'a rien produit. */
export const HEARTBEAT_MS = 10_000;
const HEARTBEAT = ': ping\n\n';

const JSON_HEADERS = {'Cache-Control': 'private, no-store'};
const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'private, no-store',
  // Inoffensif, et utile derrière un mandataire qui tamponne (nginx). Caddy,
  // lui, diffuse `text/event-stream` sans tampon par défaut (`reverse_proxy`
  // règle son `flush_interval` de lui-même) : rien à surcharger dans le
  // Caddyfile, et cet en-tête n'y change rien.
  'X-Accel-Buffering': 'no'
};

/** Ce que l'agent attend de la requête, une fois la visite enregistrée — jamais la requête. */
export type AgentVisit = {
  readonly lang: Locale;
  readonly visitorId: string;
  readonly sessionId: string;
  readonly ip: string;
};

export type StreamRouteOptions<Body extends {readonly lang: string}> = {
  /** Au-delà, le corps n'est pas lu : ce n'est pas une demande. */
  readonly bodyMaxBytes: number;
  /** Le corps analysé, ou `null` — `parseChatRequest`, `parseMatchRequest`. */
  readonly parse: (payload: unknown) => Body | null;
  /** L'appel à l'agent, par un import différé dans la route : `ask()` ou `match()`. */
  readonly call: (body: Body, visit: AgentVisit) => Promise<AskResult>;
  /** La ligne applicative quand l'agent lève hors de son contrat. */
  readonly failedEvent: string;
};

function refuse(reason: ChatRefusalReason): Response {
  const body: ChatRefusal = {ok: false, reason};
  return Response.json(body, {status: CHAT_REFUSAL_STATUS[reason], headers: JSON_HEADERS});
}

/**
 * Le corps, s'il tient dans la borne et s'il est du JSON ; sinon `null`, sans
 * avoir tout lu quand c'est dit d'avance. La borne est en **octets** des deux
 * côtés : `Content-Length` en compte, et le texte lu est mesuré en UTF-8 —
 * pas en unités UTF-16, qui en compteraient une pour un « é » qui en pèse
 * deux, ou six pour sa forme échappée en JSON.
 */
async function readPayload(request: NextRequest, bodyMaxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > bodyMaxBytes) return null;
  const text = await request.text().catch(() => null);
  if (text === null || new TextEncoder().encode(text).byteLength > bodyMaxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function streamRoute<Body extends {readonly lang: string}>(
  request: NextRequest,
  options: StreamRouteOptions<Body>
): Promise<Response> {
  const payload = await readPayload(request, options.bodyMaxBytes);
  const body = options.parse(payload);
  if (body === null || !hasLocale(routing.locales, body.lang)) return refuse('invalid_input');
  const lang = body.lang;

  // Le geste prolonge la session (AD-14) et donne à l'agent ce qu'il attend :
  // visiteur, session, adresse — une seule lecture de chacun. Sans cookies
  // valides, ou avec la session d'un autre visiteur, l'agent n'est pas appelé.
  const visit = await recordVisit({cookies: request.cookies, headers: request.headers, lang});
  if (visit === null) {
    // Cookies valides mais journal en échec (déjà dit, `journal.write_failed`) :
    // l'échange ne pourrait pas être réservé, c'est le modèle qui est indisponible.
    return refuse(visitIds(request.cookies) === null ? 'no_visitor' : 'model_unavailable');
  }
  if (visit.outcome === 'mismatch') return refuse('no_visitor');

  let result: AskResult;
  try {
    result = await options.call(body, {
      lang,
      visitorId: visit.visitorId,
      sessionId: visit.sessionId,
      ip: visit.ip
    });
  } catch (error) {
    // Jamais le texte du visiteur : la raison seule.
    console.error(
      JSON.stringify({
        level: 'error',
        event: options.failedEvent,
        reason: error instanceof Error ? error.message : String(error),
        text: "L'agent a levé hors de son contrat : la demande est refusée comme indisponible."
      })
    );
    return refuse('model_unavailable');
  }
  if (!result.ok) return refuse(result.reason);

  const encoder = new TextEncoder();
  let gone = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Le battement de cœur, tant que rien n'est venu de l'agent : arrêté au
      // premier événement, et jamais écrit après le départ du client.
      let produced = false;
      const heartbeat = setInterval(() => {
        if (produced || gone) return;
        controller.enqueue(encoder.encode(HEARTBEAT));
      }, HEARTBEAT_MS);
      try {
        for await (const event of result.events) {
          produced = true;
          // Le client est parti : on n'écrit plus, mais on ne coupe rien —
          // l'agent finalise seul. Sortir de la boucle suffit : la file de
          // l'agent ne dépend pas de son lecteur.
          if (gone) break;
          const {type, ...data} = event;
          controller.enqueue(encoder.encode(formatSseEvent(type, data)));
        }
      } finally {
        clearInterval(heartbeat);
      }
      if (!gone) controller.close();
    },
    cancel() {
      gone = true;
    }
  });
  return new Response(stream, {status: 200, headers: STREAM_HEADERS});
}
