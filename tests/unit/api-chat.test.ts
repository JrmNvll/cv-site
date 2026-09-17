/**
 * `POST /api/chat` — la route, agent et journal simulés (AD-16, story 6).
 * Chaque ligne de refus de la matrice, le format SSE, `no_visitor` sur
 * `mismatch`, l'abandon du client toléré — et le garde qui interdit à `app`
 * et `journal` de nommer l'API du modèle.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NextRequest} from 'next/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AgentEvent} from '@/agent';
import {CHAT_REFUSAL_STATUS, createSseDecoder, type ChatEvent} from '@/app/_lib/chat-contract';

const agent = vi.hoisted(() => ({ask: vi.fn()}));
const journal = vi.hoisted(() => ({touchSession: vi.fn()}));

vi.mock('@/agent', () => agent);
vi.mock('@/journal', () => journal);

type Route = typeof import('@/app/api/chat/route');
let route: Route;

const VISITOR_ID = '01K4EXAMPVSTR0000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const EXCHANGE_ID = '01K4EXAMPXCHG0000000000000';
const COOKIES = `cv_visitor=${VISITOR_ID}; cv_session=${SESSION_ID}.1757930400000`;

/** Un appel à la route : un corps (JSON ou brut), avec ou sans cookies, et des en-têtes en plus. */
function appel(body: unknown, cookie: string | null = COOKIES, raw = false, extra: Record<string, string> = {}) {
  const request = new NextRequest('http://127.0.0.1:3000/api/chat', {
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

/** Un flux d'événements que l'agent simulé rend, tel quel. */
async function* flux(events: readonly AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

/** Les événements SSE d'une réponse, décodés par le même décodeur que le navigateur. */
async function lire(response: Response): Promise<ChatEvent[]> {
  const texte = await response.text();
  const decoder = createSseDecoder();
  return [...decoder.push(texte), ...decoder.end()];
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  route = await import('@/app/api/chat/route');
  journal.touchSession.mockReturnValue({outcome: 'prolonged', visitorCreated: false});
  agent.ask.mockResolvedValue({
    ok: true,
    exchangeId: EXCHANGE_ID,
    events: flux([
      {type: 'delta', text: 'Bon'},
      {type: 'delta', text: 'jour.\n\n- a'},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: EXCHANGE_ID}
    ])
  });
});

describe('la route', () => {
  it('nʼest jamais rendue au build (AD-2)', () => {
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('question couverte, avec cookies', () => {
  it('prolonge la session, appelle lʼagent avec ce quʼil attend, et diffuse delta… done en SSE', async () => {
    const response = await appel({question: '  Pourquoi cherche-t-elle ?  ', lang: 'fr'});

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(journal.touchSession).toHaveBeenCalledWith(
      expect.objectContaining({visitorId: VISITOR_ID, sessionId: SESSION_ID, lang: 'fr'})
    );
    // L'agent reçoit la langue de la page, le visiteur, la session, l'adresse et la question sans ses blancs.
    expect(agent.ask).toHaveBeenCalledWith({
      lang: 'fr',
      visitorId: VISITOR_ID,
      sessionId: SESSION_ID,
      ip: 'dev',
      question: 'Pourquoi cherche-t-elle ?'
    });
    expect(await lire(response)).toEqual([
      {type: 'delta', text: 'Bon'},
      {type: 'delta', text: 'jour.\n\n- a'},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: EXCHANGE_ID}
    ]);
  });

  it('écrit le format SSE exact : un nom, un JSON, une ligne vide', async () => {
    const response = await appel({question: 'Q', lang: 'en'});
    expect(await response.text()).toBe(
      'event: delta\ndata: {"text":"Bon"}\n\n' +
        'event: delta\ndata: {"text":"jour.\\n\\n- a"}\n\n' +
        `event: done\ndata: {"sources":["qa:lic-01"],"exchangeId":"${EXCHANGE_ID}"}\n\n`
    );
    expect(agent.ask).toHaveBeenCalledWith(expect.objectContaining({lang: 'en'}));
    expect(journal.touchSession).toHaveBeenCalledWith(expect.objectContaining({lang: 'en'}));
  });

  it('transmet une erreur en cours de flux comme un événement, après les deltas', async () => {
    agent.ask.mockResolvedValue({
      ok: true,
      exchangeId: EXCHANGE_ID,
      events: flux([{type: 'delta', text: 'Début'}, {type: 'error', reason: 'model_unavailable'}])
    });

    const response = await appel({question: 'Q', lang: 'fr'});

    expect(response.status).toBe(200);
    expect(await lire(response)).toEqual([
      {type: 'delta', text: 'Début'},
      {type: 'error', reason: 'model_unavailable'}
    ]);
  });

  it('tolère lʼabandon du client : le flux annulé nʼempêche pas lʼagent dʼaller au bout', async () => {
    let consumed = 0;
    let finished = false;
    async function* lent(): AsyncGenerator<AgentEvent> {
      for (const text of ['a', 'b', 'c']) {
        consumed += 1;
        yield {type: 'delta', text};
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      yield {type: 'done', sources: [], exchangeId: EXCHANGE_ID};
      finished = true;
    }
    agent.ask.mockResolvedValue({ok: true, exchangeId: EXCHANGE_ID, events: lent()});

    const response = await appel({question: 'Q', lang: 'fr'});
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // La route n'a rien cassé : elle a cessé d'écrire, sans lever.
    expect(consumed).toBeGreaterThanOrEqual(1);
    // Ce qui garantit la finalisation, c'est l'agent (voir `gateway.test.ts`),
    // pas la route : ici, l'itérateur simulé s'arrête là où la route l'a lâché.
    expect(finished).toBe(false);
  });
});

describe('entrée invalide : 400, rien lu, rien écrit', () => {
  it.each([
    ['corps non JSON', '{pas du json', true],
    ['pas un objet', '"texte"', true],
    ['sans question', {lang: 'fr'}, false],
    ['question vide', {question: '', lang: 'fr'}, false],
    ['question blanche', {question: '   \n ', lang: 'fr'}, false],
    ['question trop longue', {question: 'x'.repeat(1001), lang: 'fr'}, false],
    ['question qui nʼest pas une chaîne', {question: 42, lang: 'fr'}, false],
    ['langue absente', {question: 'Q'}, false],
    ['langue inconnue', {question: 'Q', lang: 'de'}, false],
    ['langue en majuscules', {question: 'Q', lang: 'FR'}, false]
  ])('%s', async (_label, body, raw) => {
    const response = await appel(body, COOKIES, raw);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ok: false, reason: 'invalid_input'});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(agent.ask).not.toHaveBeenCalled();
  });

  it('accepte une question de mille caractères exactement', async () => {
    const response = await appel({question: 'x'.repeat(1000), lang: 'fr'});
    expect(response.status).toBe(200);
  });

  it('refuse un corps au-delà de la borne, annoncé par Content-Length ou constaté à la lecture, sans lʼanalyser', async () => {
    expect(route.BODY_MAX_BYTES).toBe(8192);
    // Annoncé : refusé avant même de lire.
    const annonce = await appel({question: 'Q', lang: 'fr'}, COOKIES, false, {'content-length': String(route.BODY_MAX_BYTES + 1)});
    expect(annonce.status).toBe(400);
    expect(await annonce.json()).toEqual({ok: false, reason: 'invalid_input'});
    // Constaté : un corps sans Content-Length utile, trop long une fois lu.
    const gros = JSON.stringify({question: 'Q', lang: 'fr', bourrage: 'x'.repeat(route.BODY_MAX_BYTES)});
    const constate = await appel(gros, COOKIES, true);
    expect(constate.status).toBe(400);
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(agent.ask).not.toHaveBeenCalled();
    // Juste sous la borne : accepté.
    const limite = JSON.stringify({question: 'Q', lang: 'fr', bourrage: 'x'.repeat(route.BODY_MAX_BYTES - 60)});
    expect(limite.length).toBeLessThanOrEqual(route.BODY_MAX_BYTES);
    expect((await appel(limite, COOKIES, true)).status).toBe(200);
  });
});

describe('lʼagent hors contrat', () => {
  it('une exception de ask() vaut 503 model_unavailable en JSON, dite sans la question', async () => {
    agent.ask.mockRejectedValue(new Error('index de connaissance cassé (simulé)'));
    const signale = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await appel({question: 'Question-Sentinelle-Route ?', lang: 'fr'});

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ok: false, reason: 'model_unavailable'});
    expect(response.headers.get('content-type')).toContain('application/json');
    const lignes = signale.mock.calls.map((call) => String(call[0]));
    expect(lignes.some((ligne) => ligne.includes('agent.ask_failed') && ligne.includes('index de connaissance cassé'))).toBe(true);
    expect(lignes.join('\n')).not.toContain('Sentinelle-Route');
    signale.mockRestore();
  });
});

describe('le battement de cœur', () => {
  it('écrit « : ping » toutes les dix secondes tant que lʼagent nʼa rien produit, puis plus jamais', async () => {
    vi.useFakeTimers();
    let liberer!: () => void;
    const porte = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    async function* tardif(): AsyncGenerator<AgentEvent> {
      await porte;
      yield {type: 'delta', text: 'enfin'};
      yield {type: 'done', sources: [], exchangeId: EXCHANGE_ID};
    }
    agent.ask.mockResolvedValue({ok: true, exchangeId: EXCHANGE_ID, events: tardif()});
    const response = await appel({question: 'Q', lang: 'fr'});
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const lu = async () => decoder.decode((await reader.read()).value);

    // Rien avant dix secondes ; un ping à dix, un autre à vingt.
    const premier = lu();
    await vi.advanceTimersByTimeAsync(route.HEARTBEAT_MS);
    expect(await premier).toBe(': ping\n\n');
    const second = lu();
    await vi.advanceTimersByTimeAsync(route.HEARTBEAT_MS);
    expect(await second).toBe(': ping\n\n');

    // L'agent produit : plus aucun ping, même dix secondes plus tard.
    liberer();
    expect(await lu()).toBe('event: delta\ndata: {"text":"enfin"}\n\n');
    await vi.advanceTimersByTimeAsync(route.HEARTBEAT_MS * 2);
    expect(await lu()).toBe(`event: done\ndata: {"sources":[],"exchangeId":"${EXCHANGE_ID}"}\n\n`);
    expect((await reader.read()).done).toBe(true);
    // Le décodeur du navigateur ignore les commentaires : rien d'autre que les deux événements.
    const sse = createSseDecoder();
    expect([...sse.push(': ping\n\n: ping\n\nevent: delta\ndata: {"text":"enfin"}\n\n'), ...sse.end()]).toEqual([
      {type: 'delta', text: 'enfin'}
    ]);
  });
});

describe('sans visiteur : 401, rien écrit', () => {
  it.each([
    ['sans cookies', null],
    ['cookies qui ne sont pas des ULID', 'cv_visitor=forge; cv_session=forge.1'],
    ['visiteur seul', `cv_visitor=${VISITOR_ID}`]
  ])('%s', async (_label, cookie) => {
    const response = await appel({question: 'Q', lang: 'fr'}, cookie);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ok: false, reason: 'no_visitor'});
    expect(journal.touchSession).not.toHaveBeenCalled();
    expect(agent.ask).not.toHaveBeenCalled();
  });

  it('session présentée avec le cookie dʼun autre visiteur (mismatch) : 401, lʼagent nʼest pas appelé', async () => {
    journal.touchSession.mockReturnValue({outcome: 'mismatch', visitorCreated: false});

    const response = await appel({question: 'Q', lang: 'fr'});

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ok: false, reason: 'no_visitor'});
    expect(agent.ask).not.toHaveBeenCalled();
  });

  it('cookies valides mais journal en échec : 503 model_unavailable, lʼagent nʼest pas appelé', async () => {
    journal.touchSession.mockImplementation(() => {
      throw new Error('base verrouillée (simulé)');
    });
    const signale = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await appel({question: 'Q', lang: 'fr'});

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ok: false, reason: 'model_unavailable'});
    expect(agent.ask).not.toHaveBeenCalled();
    expect(signale.mock.calls.some((call) => String(call[0]).includes('journal.write_failed'))).toBe(true);
    signale.mockRestore();
  });
});

describe('les refus de lʼagent', () => {
  it.each([
    ['rate_limited', 429],
    ['cap_reached', 503],
    ['model_unavailable', 503],
    ['invalid_input', 400]
  ] as const)('%s → %i, en JSON, après la session prolongée', async (reason, status) => {
    agent.ask.mockResolvedValue({ok: false, reason});

    const response = await appel({question: 'Q', lang: 'fr'});

    expect(response.status).toBe(status);
    expect(CHAT_REFUSAL_STATUS[reason]).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ok: false, reason});
    expect(journal.touchSession).toHaveBeenCalledTimes(1);
  });
});

describe('aucun appel au modèle hors de la couche agent', () => {
  const ROOT = fileURLToPath(new URL('../../src', import.meta.url));

  function sources(directory: string, found: string[] = []): string[] {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) sources(path, found);
      else if (/\.tsx?$/.test(entry)) found.push(path);
    }
    return found;
  }

  it('ni `app` ni `journal` ne nomment lʼAPI du modèle', () => {
    const fautes = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'journal'))].filter((path) =>
      /anthropic/i.test(readFileSync(path, 'utf8'))
    );
    expect(fautes.map((path) => path.slice(ROOT.length))).toEqual([]);
  });

  it('un seul fichier importe le SDK : src/agent/gateway.ts', () => {
    const importateurs = sources(ROOT).filter((path) => /@anthropic-ai\/sdk/.test(readFileSync(path, 'utf8')));
    expect(importateurs.map((path) => path.slice(ROOT.length).split('\\').join('/'))).toEqual(['/agent/gateway.ts']);
  });

  it('la route atteint lʼagent à lʼappel, jamais au chargement, et nʼimporte ni knowledge ni journal', () => {
    const source = readFileSync(join(ROOT, 'app', 'api', 'chat', 'route.ts'), 'utf8');
    expect(source).toContain("await import('@/agent')");
    expect(source).not.toMatch(/from\s+['"]@\/(content|journal|agent|knowledge)['"]/);
    expect(source).not.toMatch(/@\/knowledge|@\/journal|@\/content/);
  });
});
