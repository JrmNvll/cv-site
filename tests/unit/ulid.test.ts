/**
 * Les identifiants du journal et des cookies sont des ULID : triables par ordre
 * de création et sans dépendance externe.
 */
import {describe, expect, it} from 'vitest';
import {ULID_LENGTH, ULID_PATTERN, isUlid, ulid, ulidTime} from '@/lib/ulid';

describe('ulid', () => {
  it('produit 26 caractères de lʼalphabet de Crockford', () => {
    const value = ulid();
    expect(value).toHaveLength(ULID_LENGTH);
    expect(isUlid(value)).toBe(true);
  });

  it('encode lʼhorodatage fourni et le relit', () => {
    const now = Date.parse('2026-09-08T10:00:00.000Z');
    expect(ulidTime(ulid(now))).toBe(now);
  });

  it('est monotone dans le temps, à préfixe comparable', () => {
    const earlier = ulid(Date.parse('2026-01-01T00:00:00.000Z'));
    const later = ulid(Date.parse('2026-09-08T10:00:00.000Z'));
    expect(earlier < later).toBe(true);
  });

  it('ne répète pas la partie aléatoire', () => {
    const now = Date.now();
    const values = new Set(Array.from({length: 500}, () => ulid(now)));
    expect(values.size).toBe(500);
  });

  it('borne le premier caractère : au-delà, lʼhorodatage dépasserait 48 bits', () => {
    expect(ULID_PATTERN.source).toContain('[0-7]');
    // 8ZZZZZZZZZ… serait hors des bornes que `encodeTime` accepte.
    expect(isUlid('8ZZZZZZZZZ0000000000000000')).toBe(false);
    expect(isUlid('7ZZZZZZZZZ0000000000000000')).toBe(true);
  });

  it('dérive sa longueur des constantes du module', () => {
    expect(ULID_PATTERN.source).toContain(String(ULID_LENGTH - 1));
    expect(ulid()).toHaveLength(ULID_LENGTH);
  });

  it('rejette ce qui nʼest pas un ULID', () => {
    expect(isUlid('pas-un-ulid')).toBe(false);
    expect(isUlid('')).toBe(false);
    expect(isUlid(undefined)).toBe(false);
    // I, L, O et U sont absents de l'alphabet de Crockford.
    expect(isUlid('01K4EXAMPLEILOU00000000000')).toBe(false);
    expect(() => ulidTime('pas-un-ulid')).toThrow();
  });
});
