/**
 * AD-6 — la table de prix datée, le coût réel depuis les compteurs, la
 * réservation avant l'appel, et les bornes qui protègent l'argent.
 */
import {describe, expect, it} from 'vitest';
import {
  CHARS_PER_TOKEN,
  costMicroUsd,
  MAX_AD_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TOKENS,
  MICRO_USD_PER_TOKEN,
  MODEL,
  MONTHLY_CAP_MICRO_USD,
  PRICING_DATE,
  reservationMicroUsd
} from '@/agent/pricing';
import {AD_MAX_CHARS, QUESTION_MAX_CHARS} from '@/app/_lib/chat-contract';

describe('la table de prix', () => {
  it('est datée, pour claude-opus-5 : 5 / 25 USD par MTok, écriture de cache × 1,25, lecture × 0,1', () => {
    expect(MODEL).toBe('claude-opus-5');
    expect(PRICING_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MICRO_USD_PER_TOKEN).toEqual({input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5});
  });

  it('fixe le plafond à 5,00 USD, max_tokens à 1 500 pour une question et 2 500 pour une annonce, la question à 1 000 caractères et lʼannonce à 8 000', () => {
    expect(MONTHLY_CAP_MICRO_USD).toBe(5_000_000);
    expect(MAX_TOKENS).toEqual({chat: 1500, match: 2500});
    expect(MAX_QUESTION_CHARS).toBe(1000);
    expect(MAX_AD_CHARS).toBe(8000);
    // Les bornes du contrat des routes sont les mêmes, recopiées sans import : verrouillées ici.
    expect(QUESTION_MAX_CHARS).toBe(MAX_QUESTION_CHARS);
    expect(AD_MAX_CHARS).toBe(MAX_AD_CHARS);
  });
});

describe('costMicroUsd', () => {
  it('somme les quatre compteurs au prix de chacun, arrondi à lʼentier', () => {
    expect(
      costMicroUsd({
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 200
      })
    ).toBe(1000 * 5 + 100 * 25 + 8000 * 0.5 + 200 * 6.25);
    // Un demi micro-USD s'arrondit une fois, à la fin.
    expect(costMicroUsd({input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1})).toBe(1);
    expect(costMicroUsd({input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 3})).toBe(2);
  });

  it('traite un compteur absent, nul ou négatif comme zéro', () => {
    expect(costMicroUsd({input_tokens: 10, output_tokens: 1})).toBe(75);
    expect(costMicroUsd({input_tokens: 10, output_tokens: 1, cache_read_input_tokens: null})).toBe(75);
    expect(costMicroUsd({input_tokens: -5, output_tokens: Number.NaN})).toBe(0);
  });

  it('donne lʼordre de grandeur attendu : ≈ 0,08 USD au premier appel, ≈ 0,035 USD en cache', () => {
    const premier = costMicroUsd({input_tokens: 3000, output_tokens: 600, cache_creation_input_tokens: 8000});
    const suivant = costMicroUsd({input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 8000});
    expect(premier).toBe(80_000);
    expect(suivant).toBe(34_000);
  });
});

describe('reservationMicroUsd', () => {
  it('estime lʼentrée à un jeton pour deux caractères, au prix dʼécriture du cache, plus le max_tokens de la sorte dʼappel en sortie', () => {
    expect(CHARS_PER_TOKEN).toBe(2);
    expect(reservationMicroUsd(0, 'chat')).toBe(1500 * 25);
    expect(reservationMicroUsd(0, 'match')).toBe(2500 * 25);
    // Des micro-USD entiers : arrondis, jamais des fractions.
    expect(reservationMicroUsd(2, 'chat')).toBe(Math.round(6.25 + 1500 * 25));
    expect(reservationMicroUsd(3, 'chat')).toBe(Math.round(12.5 + 1500 * 25));
    // Le contexte réel (≈ 41 000 caractères) : ≈ 0,166 USD pour une question, ≈ 0,191 pour une annonce.
    expect(reservationMicroUsd(41_000, 'chat')).toBe(20_500 * 6.25 + 37_500);
    expect(reservationMicroUsd(41_000, 'match')).toBe(20_500 * 6.25 + 62_500);
  });

  it('couvre le premier appel réel du 2026-09-17 : 0,128 USD facturés pour 41 000 caractères envoyés', () => {
    // Noyau en écriture de cache, entrée variable au prix plein, 593 jetons de sortie.
    const reel = costMicroUsd({
      input_tokens: 3282,
      output_tokens: 593,
      cache_creation_input_tokens: 15_435,
      cache_read_input_tokens: 0
    });
    expect(reel).toBe(127_704);
    expect(reservationMicroUsd(41_000, 'chat')).toBeGreaterThan(reel);
  });

  it('ne présume pas du cache : la réservation dépasse le coût réel dʼun appel en cache', () => {
    const chars = 33_000;
    const reel = costMicroUsd({input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 8000});
    expect(reservationMicroUsd(chars, 'chat')).toBeGreaterThan(reel);
    expect(reservationMicroUsd(-10, 'chat')).toBe(1500 * 25);
    expect(reservationMicroUsd(-10, 'match')).toBe(2500 * 25);
  });
});
