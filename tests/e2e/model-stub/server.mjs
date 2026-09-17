/**
 * Le simulateur de l'API du modèle — **la preuve navigateur** des stories 6
 * et 7.
 *
 * Il parle le format SSE de `POST /v1/messages` sur `ANTHROPIC_BASE_URL` ; le
 * SDK réel fait le reste, et rien n'est facturé. Un appel réel n'a lieu qu'en
 * story 10, sur demande. Les scénarios sont choisis par le dernier message du
 * visiteur (`scenarios.json`) — un marqueur dans la question, ou une annonce
 * dans `<annonce>` :
 *
 *  - ordinaire : une réponse Markdown, un bloc `<sources>` **fragmenté** sur
 *    plusieurs deltas, des sources valides ;
 *  - `[invalide]` : la même, avec une source invalide (`qa:inexistante`) ;
 *  - `[erreur]` : deux deltas, puis un événement `error` de l'API — le SDK
 *    lève, la passerelle finalise en `model_error` ;
 *  - `[plafond]` : une réponse dont le `usage` vaut plus de 5 USD — la
 *    question suivante est refusée `cap_reached` ;
 *  - `[lent]` : douze secondes de silence avant le premier delta — la
 *    réflexion du modèle, que le battement de cœur de la route doit couvrir ;
 *  - `[espace]` : des deltas espacés d'une seconde et demie — le temps qu'un
 *    client parte au milieu du flux ;
 *  - une annonce (`<annonce>` dans le dernier message) : une évaluation en
 *    quatre parties dans la langue des règles, titres en gras, marques
 *    `[qa:…]` / `[cv:…]` **fragmentées** sur plusieurs deltas, un `[` qui
 *    n'ouvre rien (« [voir CV] »), puis le bloc ; `[invalide]` dans l'annonce
 *    glisse une marque invalide sur un point fort.
 *
 * Il **vérifie** aussi ce que la passerelle envoie, et répond `400` comme
 * l'API le ferait sur ce qu'AD-6 impose : modèle, `max_tokens`, effort bas,
 * un bloc système en cache, la clé. Et il retient un condensé de chaque
 * requête (`GET /requests`) : deux appels dans la même langue — question ou
 * annonce — doivent porter le même bloc système, le préfixe de cache ; et
 * l'historique rejoué doit remplacer une annonce évaluée par sa ligne repère.
 *
 * Aucune dépendance, Node seul : lancé par `playwright.config.ts` comme second
 * `webServer`, sur `MODEL_STUB_PORT`.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
const PORT = Number(process.env.MODEL_STUB_PORT || scenarios.port);

/** Les requêtes reçues, condensées : de quoi vérifier sans relire un texte. */
const requests = [];

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function json(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json'});
  response.end(JSON.stringify(body));
}

function apiError(response, status, type, message) {
  json(response, status, {type: 'error', error: {type, message}});
}

/** Le texte d'un message : une chaîne, ou des blocs `text` concaténés. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

/** Ce qu'AD-6 impose ; la première entorse est rendue comme l'API le ferait. */
function validate(headers, body) {
  if (!headers['x-api-key']) return 'x-api-key manquant';
  if (!headers['anthropic-version']) return 'anthropic-version manquant';
  if (body.model !== 'claude-opus-5') return `model: ${String(body.model)}`;
  if (body.max_tokens !== 1200) return `max_tokens: ${String(body.max_tokens)}`;
  if (body.stream !== true) return 'stream: attendu true';
  if (!body.output_config || body.output_config.effort !== 'low') return 'output_config.effort: attendu low';
  if ('temperature' in body || 'top_p' in body || 'top_k' in body) return 'échantillonnage: refusé sur ce modèle';
  if (body.thinking && body.thinking.type === 'enabled') return 'thinking.enabled: refusé sur ce modèle';
  if (!Array.isArray(body.system) || body.system.length !== 1) return 'system: attendu un tableau d’un bloc';
  const [block] = body.system;
  if (block.type !== 'text' || typeof block.text !== 'string' || block.text.length < 1000) return 'system[0]: bloc texte attendu';
  if (!block.cache_control || block.cache_control.type !== 'ephemeral') return 'system[0].cache_control: attendu ephemeral';
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages: vide';
  if (body.messages[0].role !== 'user') return 'messages[0]: doit être user';
  if (body.messages.at(-1).role !== 'user') return 'messages[-1]: doit être user';
  for (const message of body.messages) {
    if (textOf(message.content).trim() === '') return 'messages: contenu vide';
  }
  return null;
}

/** Envoie un événement SSE au format de l'API. */
function event(response, name, data) {
  response.write(`event: ${name}\ndata: ${JSON.stringify({type: name, ...data})}\n\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stream(response, scenario) {
  const usage = scenario.usage ?? scenarios.ordinary.usage;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'request-id': `req_stub_${requests.length}`
  });
  event(response, 'message_start', {
    message: {
      id: `msg_stub_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: 1,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens
      }
    }
  });
  event(response, 'content_block_start', {index: 0, content_block: {type: 'text', text: ''}});
  // `[lent]` : le premier delta attend — comme une réflexion du modèle avant
  // son premier mot ; `[espace]` : les deltas s'espacent, le temps qu'un
  // client parte au milieu.
  if (scenario.initialDelayMs) await sleep(scenario.initialDelayMs);
  for (const [position, delta] of scenario.deltas.entries()) {
    if (position > 0) await sleep(scenario.spacingMs ?? scenarios.delayMs);
    event(response, 'content_block_delta', {index: 0, delta: {type: 'text_delta', text: delta}});
  }
  if (scenario.fail) {
    // Une erreur de l'API en plein flux, au format de l'API : le SDK lève.
    await sleep(scenarios.delayMs);
    event(response, 'error', {error: {type: 'overloaded_error', message: 'Overloaded (simulé)'}});
    response.end();
    return;
  }
  event(response, 'content_block_stop', {index: 0});
  event(response, 'message_delta', {
    delta: {stop_reason: 'end_turn', stop_sequence: null},
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens
    }
  });
  event(response, 'message_stop', {});
  response.end();
}

/** Le dernier message porte-t-il une annonce à évaluer, à la place d'une question ? */
const AD_BLOCK = /<annonce>\n([\s\S]*?)\n<\/annonce>$/;
const QUESTION_BLOCK = /<question>\n([\s\S]*?)\n<\/question>$/;

/**
 * La langue des règles : le bloc système commence par « Tu es » en français.
 * Une évaluation doit porter les titres de la langue de la page pour que le
 * contrôle de structure la trouve en ordre.
 */
function langOf(system) {
  return system.startsWith('Tu es') ? 'fr' : 'en';
}

/**
 * Une annonce : l'évaluation de la langue des règles — `[invalide]` en
 * choisit la variante à la marque invalide —, et les autres marqueurs s'y
 * combinent comme pour une question : `[erreur]` coupe après deux deltas,
 * `[plafond]` déclare le `usage` du plafond, `[lent]` retarde le premier
 * delta, `[espace]` espace les suivants.
 */
function matchScenarioFor(ad, lang) {
  const invalid = ad.includes(scenarios.markers.invalid);
  const base = {name: invalid ? 'match-invalid' : 'match', ...(invalid ? scenarios.matchInvalid : scenarios.match)[lang]};
  if (ad.includes(scenarios.markers.error)) {
    return {...base, name: `${base.name}-error`, deltas: base.deltas.slice(0, scenarios.error.deltas.length), fail: true};
  }
  if (ad.includes(scenarios.markers.cap)) return {...base, name: `${base.name}-cap`, usage: scenarios.cap.usage};
  if (ad.includes(scenarios.markers.slow)) return {...base, name: `${base.name}-slow`, initialDelayMs: scenarios.slow.initialDelayMs};
  if (ad.includes(scenarios.markers.spaced)) return {...base, name: `${base.name}-spaced`, spacingMs: scenarios.spaced.spacingMs};
  return base;
}

function scenarioFor(question, lang) {
  const ad = AD_BLOCK.exec(question);
  if (ad !== null) return matchScenarioFor(ad[1], lang);
  if (question.includes(scenarios.markers.error)) return {name: 'error', ...scenarios.error, fail: true};
  if (question.includes(scenarios.markers.cap)) return {name: 'cap', ...scenarios.cap};
  if (question.includes(scenarios.markers.invalid)) return {name: 'invalid', ...scenarios.invalid};
  if (question.includes(scenarios.markers.slow)) return {name: 'slow', ...scenarios.slow};
  if (question.includes(scenarios.markers.spaced)) return {name: 'spaced', ...scenarios.spaced};
  return {name: 'ordinary', ...scenarios.ordinary};
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, {ok: true, requests: requests.length});
  }
  if (request.method === 'GET' && url.pathname === '/requests') {
    return json(response, 200, requests);
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/messages') {
    return apiError(response, 404, 'not_found_error', `Not found: ${request.method} ${url.pathname}`);
  }

  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(response, 400, 'invalid_request_error', 'JSON illisible');
  }

  const fault = validate(request.headers, body);
  if (fault !== null) {
    requests.push({fault});
    return apiError(response, 400, 'invalid_request_error', fault);
  }

  const last = textOf(body.messages.at(-1).content);
  const lang = langOf(body.system[0].text);
  const scenario = scenarioFor(last, lang);
  requests.push({
    scenario: scenario.name,
    lang,
    model: body.model,
    max_tokens: body.max_tokens,
    effort: body.output_config.effort,
    systemSha: sha(body.system[0].text),
    systemChars: body.system[0].text.length,
    cacheControl: body.system[0].cache_control,
    messages: body.messages.length,
    lastUserChars: last.length,
    // La question du visiteur, dans son bloc `<question>`, ou son annonce dans
    // `<annonce>` : de quoi retrouver la requête d'un test parmi celles des
    // autres — jamais le dossier.
    question: QUESTION_BLOCK.exec(last)?.[1] ?? null,
    ad: AD_BLOCK.exec(last)?.[1] ?? null,
    // L'historique rejoué, tour par tour, tronqué : questions, repères et
    // réponses des tours précédents — le dossier n'y est pas, il n'est que
    // dans le dernier message.
    turns: body.messages.slice(0, -1).map((message) => ({
      role: message.role,
      head: textOf(message.content).slice(0, 120)
    }))
  });
  await stream(response, scenario);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`simulateur du modèle : http://127.0.0.1:${PORT}/v1/messages`);
});
