/**
 * Le contrat de `/api/chat` et `/api/match`, lu côté client : le corps qui
 * part, le refus nommé, les trois événements, et le décodeur SSE — coupé
 * n'importe où.
 */
import {describe, expect, it} from 'vitest';
import {
  AD_MAX_CHARS,
  clampAd,
  CHAT_EVENTS,
  CHAT_REFUSAL_REASONS,
  CHAT_REFUSAL_STATUS,
  createSseDecoder,
  formatSseEvent,
  parseChatEvent,
  parseChatRefusal,
  parseChatRequest,
  parseMatchRequest,
  QUESTION_MAX_CHARS
} from '@/app/_lib/chat-contract';

describe('parseChatRequest', () => {
  it('rend la question sans ses blancs et la langue telle quelle', () => {
    expect(parseChatRequest({question: '  Q ?  ', lang: 'fr'})).toEqual({question: 'Q ?', lang: 'fr'});
    expect(parseChatRequest({question: 'x'.repeat(QUESTION_MAX_CHARS), lang: 'en'})).not.toBeNull();
  });

  it.each([
    null,
    'texte',
    {},
    {lang: 'fr'},
    {question: 'Q'},
    {question: '', lang: 'fr'},
    {question: '  \n', lang: 'fr'},
    {question: 'x'.repeat(QUESTION_MAX_CHARS + 1), lang: 'fr'},
    {question: 42, lang: 'fr'},
    {question: 'Q', lang: ''},
    {question: 'Q', lang: 3},
    // Une annonce n'est pas une question : le champ doit s'appeler `question`.
    {ad: 'Annonce', lang: 'fr'}
  ])('rend null pour %j', (payload) => {
    expect(parseChatRequest(payload)).toBeNull();
  });
});

describe('parseMatchRequest', () => {
  it('rend lʼannonce sans ses blancs et la langue telle quelle, jusquʼà huit mille caractères', () => {
    expect(parseMatchRequest({ad: '  Annonce fictive.  ', lang: 'fr'})).toEqual({ad: 'Annonce fictive.', lang: 'fr'});
    expect(parseMatchRequest({ad: 'x'.repeat(AD_MAX_CHARS), lang: 'en'})).toEqual({ad: 'x'.repeat(AD_MAX_CHARS), lang: 'en'});
    expect(parseMatchRequest({ad: 'x'.repeat(AD_MAX_CHARS + 1), lang: 'en'})).toBeNull();
    expect(AD_MAX_CHARS).toBe(8000);
  });

  it.each([
    null,
    'texte',
    {},
    {lang: 'fr'},
    {ad: 'A'},
    {ad: '', lang: 'fr'},
    {ad: '  \n', lang: 'fr'},
    {ad: 42, lang: 'fr'},
    {ad: 'A', lang: ''},
    {ad: 'A', lang: 3},
    // Une question n'est pas une annonce : le champ doit s'appeler `ad`.
    {question: 'Q', lang: 'fr'}
  ])('rend null pour %j', (payload) => {
    expect(parseMatchRequest(payload)).toBeNull();
  });

  it('refuse un texte mal formé — une paire de substitution coupée —, pour lʼannonce comme pour la question', () => {
    const haute = String.fromCharCode(0xd83d);
    const basse = String.fromCharCode(0xde00);
    expect(parseMatchRequest({ad: `Emoji coupé ${haute}`, lang: 'fr'})).toBeNull();
    expect(parseMatchRequest({ad: `${basse} seule`, lang: 'fr'})).toBeNull();
    expect(parseChatRequest({question: `Q ${haute}`, lang: 'fr'})).toBeNull();
    // Entier, il passe.
    expect(parseMatchRequest({ad: `Emoji ${haute}${basse}`, lang: 'fr'})).toEqual({ad: `Emoji ${haute}${basse}`, lang: 'fr'});
  });
});

describe('clampAd', () => {
  const emoji = String.fromCodePoint(0x1f600);

  it('coupe à huit mille unités, sans jamais couper un emoji en deux', () => {
    expect(emoji.length).toBe(2);
    expect(clampAd('court')).toBe('court');
    expect(clampAd('x'.repeat(AD_MAX_CHARS))).toBe('x'.repeat(AD_MAX_CHARS));
    expect(clampAd('x'.repeat(AD_MAX_CHARS + 5))).toBe('x'.repeat(AD_MAX_CHARS));
    // L'emoji à cheval sur la borne : la coupe recule d'une unité.
    expect(clampAd(`${'x'.repeat(AD_MAX_CHARS - 1)}${emoji}`)).toBe('x'.repeat(AD_MAX_CHARS - 1));
    // L'emoji qui tient juste : gardé entier.
    expect(clampAd(`${'x'.repeat(AD_MAX_CHARS - 2)}${emoji}x`)).toBe(`${'x'.repeat(AD_MAX_CHARS - 2)}${emoji}`);
    // Ce qui sort est toujours bien formé et accepté par le contrat.
    for (const value of [`${'x'.repeat(AD_MAX_CHARS - 1)}${emoji}`, `${emoji.repeat(AD_MAX_CHARS)}`]) {
      const clamped = clampAd(value);
      expect(clamped.isWellFormed()).toBe(true);
      expect(parseMatchRequest({ad: clamped, lang: 'fr'})).not.toBeNull();
    }
  });
});

describe('les refus', () => {
  it('forment une liste close, chacune avec son statut dʼAD-16', () => {
    expect([...CHAT_REFUSAL_REASONS]).toEqual([
      'invalid_input',
      'no_visitor',
      'rate_limited',
      'cap_reached',
      'model_unavailable'
    ]);
    expect(CHAT_REFUSAL_STATUS).toEqual({
      invalid_input: 400,
      no_visitor: 401,
      rate_limited: 429,
      cap_reached: 503,
      model_unavailable: 503
    });
  });

  it('parseChatRefusal ne reconnaît que la liste close', () => {
    for (const reason of CHAT_REFUSAL_REASONS) {
      expect(parseChatRefusal({ok: false, reason})).toBe(reason);
    }
    expect(parseChatRefusal({ok: false, reason: 'unknown'})).toBeNull();
    expect(parseChatRefusal({ok: false, reason: 'content_unavailable'})).toBeNull();
    expect(parseChatRefusal({reason: 3})).toBeNull();
    expect(parseChatRefusal(null)).toBeNull();
    expect(parseChatRefusal('rate_limited')).toBeNull();
  });
});

describe('les événements', () => {
  it('sʼécrivent « event: nom / data: json / ligne vide », le texte encodé', () => {
    expect([...CHAT_EVENTS]).toEqual(['delta', 'done', 'error']);
    expect(formatSseEvent('delta', {text: 'a\n\nb'})).toBe('event: delta\ndata: {"text":"a\\n\\nb"}\n\n');
    expect(formatSseEvent('done', {sources: [], exchangeId: null})).toBe(
      'event: done\ndata: {"sources":[],"exchangeId":null}\n\n'
    );
  });

  it('se lisent avec leur forme exacte, et rien dʼautre', () => {
    expect(parseChatEvent('delta', '{"text":"x"}')).toEqual({type: 'delta', text: 'x'});
    expect(parseChatEvent('done', '{"sources":["qa:a-1"],"exchangeId":"01K4EXAMPXCHG0000000000000"}')).toEqual({
      type: 'done',
      sources: ['qa:a-1'],
      exchangeId: '01K4EXAMPXCHG0000000000000'
    });
    expect(parseChatEvent('done', '{"sources":[],"exchangeId":null}')).toEqual({type: 'done', sources: [], exchangeId: null});
    expect(parseChatEvent('error', '{"reason":"model_unavailable"}')).toEqual({type: 'error', reason: 'model_unavailable'});

    expect(parseChatEvent('delta', '{"text":1}')).toBeNull();
    expect(parseChatEvent('delta', 'pas du json')).toBeNull();
    expect(parseChatEvent('done', '{"sources":"qa:a-1","exchangeId":null}')).toBeNull();
    expect(parseChatEvent('done', '{"sources":[1],"exchangeId":null}')).toBeNull();
    // `exchangeId` est toujours envoyé, nul ou non : absent, ce n'est pas un `done`.
    expect(parseChatEvent('done', '{"sources":[]}')).toBeNull();
    expect(parseChatEvent('error', '{"reason":"autre"}')).toBeNull();
    expect(parseChatEvent('ping', '{}')).toBeNull();
    expect(parseChatEvent('delta', 'null')).toBeNull();
  });
});

describe('le décodeur SSE', () => {
  const flux =
    'event: delta\ndata: {"text":"Bon"}\n\n' +
    ': commentaire\nid: 3\nevent: delta\ndata: {"text":"jour"}\n\n' +
    'event: done\ndata: {"sources":["qa:lic-01"],"exchangeId":null}\n\n';

  it('lit un flux entier dʼun coup', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(flux)).toEqual([
      {type: 'delta', text: 'Bon'},
      {type: 'delta', text: 'jour'},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: null}
    ]);
    expect(decoder.end()).toEqual([]);
  });

  it('lit le même flux coupé à chaque caractère : rien ne se perd, rien ne se dédouble', () => {
    const decoder = createSseDecoder();
    const events = [...flux].flatMap((char) => decoder.push(char));
    expect([...events, ...decoder.end()]).toEqual([
      {type: 'delta', text: 'Bon'},
      {type: 'delta', text: 'jour'},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: null}
    ]);
  });

  it('accepte les fins de ligne CRLF, un data sur plusieurs lignes, et un dernier bloc sans ligne vide', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('event: delta\r\ndata: {"text":\r\ndata: "x"}\r\n\r\nevent: error\ndata: {"reason":"model_unavailable"}')).toEqual([
      {type: 'delta', text: 'x'}
    ]);
    expect(decoder.end()).toEqual([{type: 'error', reason: 'model_unavailable'}]);
  });

  it('ne perd pas un événement quand un CRLF est coupé entre deux morceaux', () => {
    const decoder = createSseDecoder();
    // `\r` en fin de morceau, `\n` au début du suivant : pas un faux séparateur.
    expect(decoder.push('event: delta\r')).toEqual([]);
    expect(decoder.push('\ndata: {"text":"x"}\r')).toEqual([]);
    expect(decoder.push('\n\r')).toEqual([]);
    expect(decoder.push('\nevent: done\r\ndata: {"sources":[],"exchangeId":null}\r\n\r\n')).toEqual([
      {type: 'delta', text: 'x'},
      {type: 'done', sources: [], exchangeId: null}
    ]);
    // Un `\r` seul en toute fin de flux n'a rien à retenir.
    const seul = createSseDecoder();
    expect(seul.push('event: error\rdata: {"reason":"model_unavailable"}\r')).toEqual([]);
    expect(seul.end()).toEqual([{type: 'error', reason: 'model_unavailable'}]);
  });

  it('ignore un bloc sans nom, sans donnée, ou mal formé', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"text":"orphelin"}\n\nevent: delta\n\nevent: delta\ndata: {"text":1}\n\n')).toEqual([]);
    expect(decoder.end()).toEqual([]);
  });
});
