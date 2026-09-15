/**
 * Le contrat de `/api/questions/<id>`, lu côté client : ce qui est une réponse,
 * ce qui est un refus nommé, et tout ce qui ne l'est pas.
 */
import {describe, expect, it} from 'vitest';
import {parseHeroAnswer, parseRefusalReason} from '@/app/_lib/questions-contract';

describe('parseHeroAnswer', () => {
  it('rend la question et le corps dʼune réponse', () => {
    expect(parseHeroAnswer({id: 'lic-01', question: 'Q ?', answer: 'Corps.', sources: []})).toEqual({
      question: 'Q ?',
      answer: 'Corps.'
    });
  });

  it.each([
    null,
    'pas un objet',
    {},
    {question: 'Q ?'},
    {question: 'Q ?', answer: 42},
    {question: '', answer: 'Corps.'},
    {question: 'Q ?', answer: '   '}
  ])('rend null pour %j : un corps inattendu ou vide nʼest pas une réponse', (payload) => {
    expect(parseHeroAnswer(payload)).toBeNull();
  });
});

describe('parseRefusalReason', () => {
  it('ne reconnaît que la liste close', () => {
    expect(parseRefusalReason({ok: false, reason: 'unknown'})).toBe('unknown');
    expect(parseRefusalReason({ok: false, reason: 'invalid_input'})).toBe('invalid_input');
    expect(parseRefusalReason({ok: false, reason: 'content_unavailable'})).toBe('content_unavailable');
    expect(parseRefusalReason({ok: false, reason: 'autre'})).toBeNull();
    expect(parseRefusalReason({reason: 3})).toBeNull();
    expect(parseRefusalReason(null)).toBeNull();
  });
});
