/**
 * `POST /api/match` — la route, agent et journal simulés (AD-16, AD-17,
 * story 7). La mécanique commune — refus `no_visitor`, statuts des refus de
 * l'agent, format SSE, battement de cœur, abandon du client — vit dans
 * `stream-route.ts` et est prouvée par `api-chat.test.ts` sur `/api/chat` ;
 * ici, seulement ce qui diffère : l'analyse du corps `{ad, lang}`, la borne de
 * 48 Kio **en octets**, `match()` appelé et jamais `ask()`, la langue anglaise,
 * la ligne `agent.match_failed` — et le garde qui interdit à cette route de
 * nommer l'API du modèle ou d'atteindre l'agent autrement qu'à l'appel.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NextRequest} from 'next/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AgentEvent} from '@/agent';
import {AD_MAX_CHARS, createSseDecoder, type ChatEvent} from '@/app/_lib/chat-contract';

const agent = vi.hoisted(() => ({ask: vi.fn(), match: vi.fn()}));
const journal = vi.hoisted(() => ({touchSession: vi.fn()}));

vi.mock('@/agent', () => agent);
vi.mock('@/journal', () => journal);

type Route = typeof import('@/app/api/match/route');
let route: Route;

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const EXCHANGE_ID = '01K4EXAMPXCHG0000000000000';
const COOKIES = `cv_visitor=${VISITOR_ID}; cv_session=${SESSION_ID}.1757930400000`;
const ANNONCE = 'Poste fictif : dix ans de parcours demandés, disponibilité immédiate.';

/** Un appel à la route : un corps (JSON ou brut), avec ou sans cookies, et des en-têtes en plus. */
function appel(body: unknown, cookie: string | null = COOKIES, raw = false, extra: Record<string, string> = {}) {
  const request = new NextRequest('http://127.0.0.1:3000/api/match', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: '127.0.0.1:3000',
      referer: 'http://127.0.0.1:3000/fr',
      'user-agent': 'Test/1.0',
      ...(cookie ? {cookie} : {}),
      ...extra
    },
    body: raw ? (body as string) : JSON.stringify(body)
  });
  return route.POST(request);
}

async function* flux(events: readonly AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

async function lire(response: Response): Promise<ChatEvent[]> {
  const texte = await response.text();
  const decoder = createSseDecoder();
  return [...decoder.push(texte), ...decoder.end()];
}

/** Les octets UTF-8 d'un corps — l'unité de la borne. */
const octets = (texte: string) => new TextEncoder().encode(texte).byteLength;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  route = await import('@/app/api/match/route');
  journal.touchSession.mockReturnValue({outcome: 'prolonged', visitorCreated: false});
  agent.match.mockResolvedValue({
    ok: true,
    exchangeId: EXCHANGE_ID,
    events: flux([
      {type: 'delta', text: '**Points forts**\n- Un point '},
      {type: 'delta', text: '\n\n**Conclusion**\nVoilà.'},
      {type: 'done', sources: ['cv:profil', 'qa:lic-01'], exchangeId: EXCHANGE_ID}
    ])
  });
});

describe('la route', () => {
  it('nʼest jamais rendue au build (AD-2), et partage le battement de cœur de /api/chat', () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.HEARTBEAT_MS).toBe(10_000);
  });
});

describe('annonce recevable, avec cookies', () => {
  it('prolonge la session, appelle match() avec ce quʼil attend — jamais ask() —, et diffuse delta… done en SSE', async () => {
    const response = await appel({ad: `  ${ANNONCE}  `, lang: 'fr'});

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({visitorId: VISITOR_ID, sessionId: SESSION_ID, lang: 'fr'})
    );
    expect(agent.match).toHaveBeenCalledWith({
      lang: 'fr',
      visitorId: VISITOR_ID,
      sessionId: SESSION_ID,
      ip: 'dev',
      ad: ANNONCE
    });
    expect(agent.ask).not.toHaveBeenCalled();
    expect(await lire(response)).toEqual([
      {type: 'delta', text: '**Points forts**\n- Un point '},
      {type: 'delta', text: '\n\n**Conclusion**\nVoilà.'},
      {type: 'done', sources: ['cv:profil', 'qa:lic-01'], exchangeId: EXCHANGE_ID}
    ]);
  });

  it('passe la langue anglaise telle quelle', async () => {
    expect((await appel({ad: ANNONCE, lang: 'en'})).status).toBe(200);
    expect(agent.match).toHaveBeenCalledWith(expect.objectContaining({lang: 'en'}));
    expect(journal.touchSession).toHaveBeenCalledWith(expect.objectContaining({lang: 'en'}));
  });
});

describe('entrée invalide : 400, rien lu, rien écrit', () => {
  it.each([
    ['corps non JSON', '{pas du json', true],
    ['pas un objet', '"texte"', true],
    ['sans annonce', {lang: 'fr'}, false],
    ['une question à la place de lʼannonce', {question: 'Q', lang: 'fr'}, false],
    ['annonce vide', {ad: '', lang: 'fr'}, false],
    ['annonce blanche', {ad: '   \n ', lang: 'fr'}, false],
    ['annonce trop longue', {ad: 'x'.repeat(AD_MAX_CHARS + 1), lang: 'fr'}, false],
    ['annonce qui nʼest pas une chaîne', {ad: 42, lang: 'fr'}, false],
    // Une paire de substitution coupée : l'API la refuserait après la réservation.
    ['annonce mal formée', {ad: `Emoji coupé ${String.fromCharCode(0xd83d)}`, lang: 'fr'}, false],
    ['langue absente', {ad: ANNONCE}, false],
    ['langue inconnue', {ad: ANNONCE, lang: 'de'}, false],
    ['langue en majuscules', {ad: ANNONCE, lang: 'FR'}, false]
  ])('%s', async (_label, body, raw) => {
    const response = await appel(body, COOKIES, raw);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ok: false, reason: 'invalid_input'});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(agent.match).not.toHaveBeenCalled();
  });

  it('accepte une annonce de huit mille caractères exactement, un emoji en dernier compris', async () => {
    const response = await appel({ad: 'x'.repeat(AD_MAX_CHARS), lang: 'fr'});
    expect(response.status).toBe(200);
    expect(agent.match).toHaveBeenCalledWith(expect.objectContaining({ad: 'x'.repeat(AD_MAX_CHARS)}));
    const emoji = String.fromCodePoint(0x1f600);
    expect((await appel({ad: `${'x'.repeat(AD_MAX_CHARS - 2)}${emoji}`, lang: 'fr'})).status).toBe(200);
  });

  it('borne le corps à 48 Kio en octets, des deux côtés : Content-Length annoncé, ou UTF-8 mesuré à la lecture', async () => {
    expect(route.BODY_MAX_BYTES).toBe(48 * 1024);
    // Annoncé : refusé avant même de lire.
    const annonce = await appel({ad: ANNONCE, lang: 'fr'}, COOKIES, false, {'content-length': String(route.BODY_MAX_BYTES + 1)});
    expect(annonce.status).toBe(400);
    expect(await annonce.json()).toEqual({ok: false, reason: 'invalid_input'});

    // Constaté en octets, pas en unités UTF-16 : un bourrage de « é » qui tient
    // en caractères mais pèse deux octets chacun dépasse la borne — refusé.
    const lourd = JSON.stringify({ad: ANNONCE, lang: 'fr', bourrage: 'é'.repeat(25_000)});
    expect(lourd.length).toBeLessThan(route.BODY_MAX_BYTES);
    expect(octets(lourd)).toBeGreaterThan(route.BODY_MAX_BYTES);
    expect((await appel(lourd, COOKIES, true)).status).toBe(400);
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(agent.match).not.toHaveBeenCalled();

    // Un corps réellement échappé en `\uXXXX` : huit mille « é » en six octets
    // chacun tiennent dans la borne, et l'annonce lue fait huit mille caractères.
    const echappe = `{"ad":"${'\\u00e9'.repeat(AD_MAX_CHARS)}","lang":"fr"}`;
    expect(echappe).toContain('\\u00e9');
    expect(octets(echappe)).toBeLessThanOrEqual(route.BODY_MAX_BYTES);
    expect((await appel(echappe, COOKIES, true)).status).toBe(200);
    expect(agent.match).toHaveBeenCalledWith(expect.objectContaining({ad: 'é'.repeat(AD_MAX_CHARS)}));
    // Le même, gonflé au-delà de la borne par un bourrage échappé : refusé.
    const trop = `{"ad":"${'\\u00e9'.repeat(AD_MAX_CHARS)}","lang":"fr","bourrage":"${'\\u00e9'.repeat(300)}"}`;
    expect(octets(trop)).toBeGreaterThan(route.BODY_MAX_BYTES);
    expect((await appel(trop, COOKIES, true)).status).toBe(400);

    // Juste sous la borne, en octets : accepté.
    const limite = JSON.stringify({ad: ANNONCE, lang: 'fr', bourrage: 'x'.repeat(route.BODY_MAX_BYTES - 200)});
    expect(octets(limite)).toBeLessThanOrEqual(route.BODY_MAX_BYTES);
    expect((await appel(limite, COOKIES, true)).status).toBe(200);
  });
});

describe('lʼagent hors contrat', () => {
  it('une exception de match() vaut 503 model_unavailable en JSON, dite agent.match_failed, sans lʼannonce', async () => {
    agent.match.mockRejectedValue(new Error('index de connaissance cassé (simulé)'));
    const signale = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await appel({ad: 'Annonce-Sentinelle-Route', lang: 'fr'});

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ok: false, reason: 'model_unavailable'});
    const lignes = signale.mock.calls.map((call) => String(call[0]));
    expect(lignes.some((ligne) => ligne.includes('agent.match_failed') && ligne.includes('index de connaissance cassé'))).toBe(true);
    expect(lignes.join('\n')).not.toContain('Sentinelle-Route');
    signale.mockRestore();
  });
});

describe('aucun appel au modèle hors de la couche agent', () => {
  const ROOT = fileURLToPath(new URL('../../src', import.meta.url));

  it('la route et la mécanique commune atteignent lʼagent à lʼappel, jamais au chargement, et ne nomment pas lʼAPI', () => {
    const route = readFileSync(join(ROOT, 'app', 'api', 'match', 'route.ts'), 'utf8');
    expect(route).toContain("await import('@/agent')");
    expect(route).not.toMatch(/from\s+['"]@\/(content|journal|agent|knowledge)['"]/);
    expect(route).not.toMatch(/@\/knowledge|@\/journal|@\/content/);
    expect(route).not.toMatch(/anthropic/i);

    const commune = readFileSync(join(ROOT, 'app', '_lib', 'stream-route.ts'), 'utf8');
    // Un type seulement : rien de `@/agent` n'est chargé par ce module.
    expect(commune).toMatch(/import type \{[^}]*\} from '@\/agent'/);
    expect(commune).not.toMatch(/import \{[^}]*\} from '@\/agent'/);
    expect(commune).not.toContain("import('@/agent')");
    expect(commune).not.toMatch(/@\/knowledge|@\/content/);
    expect(commune).not.toMatch(/anthropic/i);
  });
});
