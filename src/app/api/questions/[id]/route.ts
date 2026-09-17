/**
 * Les questions du premier écran, servies **sans appel au modèle** — CAP-2.
 *
 * Cinq puces, cinq entrées du corpus (`hero-questions.ts`) : la route rend le
 * corps de l'entrée tel qu'il est écrit, en Markdown (AD-3), et rien d'autre.
 * Aucune importation de l'API du modèle, aucune réservation de dépense : c'est
 * une lecture du contenu chargé au démarrage, transmise en JSON. La langue est
 * celle que la page demande explicitement (`?lang=`, l'URL de la page qui
 * appelle — AD-5) : jamais devinée depuis un en-tête.
 *
 * L'échange est journalisé comme n'importe quelle question (AD-7), à coût
 * nul : `kind = 'hero'`, `status = 'done'`, `cost_micro_usd = 0`, la clé de
 * citation de l'entrée en source, citations exactes par construction. Sans
 * cookies de visite valides, la route répond pareil et n'écrit rien — comme
 * `/api/contact/*` : le journal observe le geste, il ne le conditionne pas.
 *
 * Refus **avant** toute lecture : un identifiant hors des cinq (`404
 * unknown`) ou une langue hors du routage (`400 invalid_input`) ne coûtent ni
 * un accès au contenu ni une écriture au journal. Une entrée que le corpus
 * réel ne sert pas — absente, `PRIVÉ`, `PASSE`, vide — répond aussi `404`, et
 * l'avertissement est journalisé une fois par processus : c'est un défaut du
 * contenu, à corriger dans le dépôt privé, pas un bruit à chaque clic.
 *
 * `no-store` : la réponse dépend des cookies (identifiant d'échange) et il n'y
 * a rien à mettre en cache d'une lecture en mémoire.
 */
import {hasLocale} from 'next-intl';
import type {NextRequest} from 'next/server';
import {isHeroQuestion} from '@/app/(site)/[locale]/_components/hero-questions';
import {type HeroAnswer, type HeroRefusal} from '@/app/_lib/questions-contract';
import {recordVisit} from '@/app/_lib/visit';
import {routing} from '@/i18n/routing';

/**
 * Jamais rendue au build. `force-dynamic` ne suffit pas : Next charge le module
 * pour en lire les exports, et un `import` statique de `@/content` entraînerait
 * `@/env`, dont le parsage a lieu au chargement. D'où les imports différés de
 * `@/content` et de `@/journal` **dans** la fonction (voir `api/photo/route.ts`).
 */
export const dynamic = 'force-dynamic';

const HEADERS = {'Cache-Control': 'private, no-store'};

/**
 * Les entrées déjà signalées, pour n'avertir qu'une fois par processus et par
 * entrée. Dix combinaisons au plus (cinq identifiants, deux langues) : rien à
 * borner.
 */
const reportedMissing = new Set<string>();

function refuse(status: 404 | 400, reason: HeroRefusal['reason']): Response {
  const body: HeroRefusal = {ok: false, reason};
  return Response.json(body, {status, headers: HEADERS});
}

function warnMissingOnce(lang: string, id: string, statut: string | undefined): void {
  const key = `${lang}:${id}`;
  if (reportedMissing.has(key)) return;
  reportedMissing.add(key);
  // L'identifiant et le statut, jamais le corps : le contenu reste privé.
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'questions.entry_unavailable',
      lang,
      id,
      statut: statut ?? 'absente',
      text: "Question du premier écran sans entrée ordinaire dans le corpus : la puce répond une erreur."
    })
  );
}

export async function GET(
  request: NextRequest,
  {params}: {params: Promise<{id: string}>}
): Promise<Response> {
  const started = performance.now();
  const {id} = await params;
  if (!isHeroQuestion(id)) return refuse(404, 'unknown');

  const lang = request.nextUrl.searchParams.get('lang');
  if (!hasLocale(routing.locales, lang)) return refuse(400, 'invalid_input');

  const {qaEntry} = await import('@/content');
  const entry = qaEntry(lang, id);
  // Une entrée absente, non ordinaire ou au corps blanc est un défaut du
  // contenu, permanent jusqu'à correction : une raison à part, pour que le
  // panneau ne dise pas « réessayez plus tard ».
  if (entry === undefined || entry.statut !== 'normale' || !entry.corps?.trim()) {
    warnMissingOnce(lang, id, entry?.statut);
    return refuse(404, 'content_unavailable');
  }

  // Le geste prolonge la session (AD-14), puis l'échange s'y rattache. Sans
  // cookies valides, `recordVisit` rend `null` et rien n'est écrit ; une
  // session présentée avec le cookie d'un autre visiteur (`mismatch`) n'est
  // pas prolongée, et un échange ne s'y rattache pas non plus. Au-delà de
  // `HERO_EXCHANGES_PER_SESSION`, le journal rend `null` : la réponse est
  // servie, `exchangeId` aussi — nul.
  const visit = await recordVisit({cookies: request.cookies, headers: request.headers, lang});
  let exchangeId: string | null = null;
  if (visit !== null && visit.outcome !== 'mismatch') {
    try {
      const {addExchange} = await import('@/journal');
      exchangeId =
        addExchange({
          sessionId: visit.sessionId,
          kind: 'hero',
          question: entry.question,
          answer: entry.corps,
          sources: [entry.source],
          citationOk: true,
          latencyMs: performance.now() - started
        })?.id ?? null;
    } catch (error) {
      // Même règle que la visite : l'échec du journal se dit, la réponse part.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'journal.write_failed',
          reason: error instanceof Error ? error.message : String(error),
          text: "L'échange n'a pas été journalisé ; la réponse est servie quand même."
        })
      );
    }
  }

  const body: HeroAnswer = {
    id,
    question: entry.question,
    answer: entry.corps,
    sources: [entry.source],
    exchangeId
  };
  return Response.json(body, {headers: HEADERS});
}
