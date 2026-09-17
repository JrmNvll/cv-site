/**
 * La mise en forme de l'admin (`src/app/(admin)/admin/_lib/format.ts`) :
 * l'heure de Zurich en français de Suisse, les micro-USD, les identifiants
 * abrégés, la page hors bornes. Rien ne vient de la base : des valeurs, des
 * chaînes.
 */
import {describe, expect, it} from 'vitest';
import {
  addressLabel,
  formatInstant,
  formatInteger,
  formatLatency,
  formatMicroUsd,
  KIND_LABELS,
  labelOrNull,
  langLabel,
  parsePage,
  shortId,
  STATUS_LABELS,
  visitorLabel
} from '@/app/(admin)/admin/_lib/format';
import {currentSection} from '@/app/(admin)/admin/_components/admin-nav';
import {pageHref} from '@/app/(admin)/admin/page';
import {EXCHANGE_KINDS, EXCHANGE_STATUSES} from '@/journal/schema';

describe('les instants', () => {
  it('écrit un instant UTC à lʼheure de Zurich, jour.mois.année heure:minute', () => {
    // Heure d'été : UTC+2.
    expect(formatInstant('2026-09-17T09:40:05.000Z')).toBe('17.09.2026 11:40');
    expect(formatInstant('2026-09-17T09:40:05.000Z', {seconds: true})).toBe('17.09.2026 11:40:05');
    // Heure d'hiver : UTC+1, et le jour change à minuit — « 00:30 », jamais « 24:30 ».
    expect(formatInstant('2026-01-31T23:30:00.000Z')).toBe('01.02.2026 00:30');
    expect(formatInstant('2026-01-31T23:00:00.000Z', {seconds: true})).toBe('01.02.2026 00:00:00');
  });

  it('rend une valeur illisible telle quelle', () => {
    expect(formatInstant('pas une date')).toBe('pas une date');
  });
});

describe('les nombres', () => {
  it('écrit les micro-USD en USD à trois décimales, virgule décimale', () => {
    expect(formatMicroUsd(128_000)).toBe('0,128 USD');
    expect(formatMicroUsd(0)).toBe('0,000 USD');
    expect(formatMicroUsd(5_000_000)).toBe('5,000 USD');
    // Le séparateur de milliers est celui d'ICU pour fr-CH (une apostrophe, droite ou typographique selon la version).
    expect(formatMicroUsd(1_234_567_890)).toBe(`${new Intl.NumberFormat('fr-CH', {minimumFractionDigits: 3}).format(1234.568)} USD`);
    expect(formatMicroUsd(1_234_567_890)).toMatch(/^1.234,568 USD$/);
    expect(formatMicroUsd(null)).toBe('—');
    expect(formatMicroUsd(undefined)).toBe('—');
  });

  it('écrit un entier groupé, et une latence en secondes', () => {
    expect(formatInteger(15_234)).toBe(new Intl.NumberFormat('fr-CH').format(15_234));
    expect(formatInteger(15_234)).toMatch(/^15.234$/);
    expect(formatInteger(null)).toBe('—');
    expect(formatLatency(1234)).toBe('1,2 s');
    expect(formatLatency(0)).toBe('0,0 s');
    expect(formatLatency(null)).toBe('—');
  });
});

describe('les libellés', () => {
  it('abrège un ULID par ses quatre premiers et quatre derniers caractères', () => {
    expect(shortId('01K4EXAMPVSTR0000000000XYZ')).toBe('01K4…0XYZ');
    expect(shortId('court')).toBe('court');
  });

  it('un nom ou une étiquette vides valent absents : lʼidentifiant ou lʼadresse reprennent la place', () => {
    expect(labelOrNull(null)).toBeNull();
    expect(labelOrNull('')).toBeNull();
    expect(labelOrNull('  ')).toBeNull();
    expect(labelOrNull(' Nom ')).toBe('Nom');
    expect(visitorLabel('Recruteuse fictive', '01K4EXAMPVSTR0000000000XYZ')).toBe('Recruteuse fictive');
    expect(visitorLabel('', '01K4EXAMPVSTR0000000000XYZ')).toBe('01K4…0XYZ');
    expect(visitorLabel(null, '01K4EXAMPVSTR0000000000XYZ')).toBe('01K4…0XYZ');
    expect(addressLabel('Bureau fictif', '203.0.113.7')).toBe('Bureau fictif');
    expect(addressLabel('', '203.0.113.7')).toBe('203.0.113.7');
    expect(addressLabel(null, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('nomme chaque sorte et chaque statut du journal, en français', () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...EXCHANGE_KINDS].sort());
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...EXCHANGE_STATUSES].sort());
    expect(langLabel('fr')).toBe('français');
    expect(langLabel('en')).toBe('anglais');
    expect(langLabel('de')).toBe('de');
  });
});

describe('la page', () => {
  it('lit un entier à partir de 1, sinon la première page ; une page lointaine passe', () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage('1.5')).toBe(1);
    expect(parsePage('2')).toBe(2);
    expect(parsePage('999')).toBe(999);
    expect(parsePage(['3', '4'])).toBe(3);
    // Des chiffres seulement : ce que `Number()` accepterait par ailleurs vaut la première page.
    for (const louche of ['1e3', '0x10', ' 2 ', '2 ', '+2', '2.0', '1e12', '12345678', '', '٣']) {
      expect(parsePage(louche), JSON.stringify(louche)).toBe(1);
    }
    expect(parsePage('0000002')).toBe(2);
  });
});

describe('les adresses des pages', () => {
  it('pageHref garde tout=1 et nʼécrit page que passée la première', () => {
    expect(pageHref(1, false)).toBe('/admin');
    expect(pageHref(2, false)).toBe('/admin?page=2');
    expect(pageHref(1, true)).toBe('/admin?tout=1');
    expect(pageHref(2, true)).toBe('/admin?tout=1&page=2');
    expect(pageHref(3, true)).toBe('/admin?tout=1&page=3');
  });

  it('currentSection : les questions et tout ce qui est dessous, sinon le tableau de bord', () => {
    expect(currentSection('/admin')).toBe('/admin');
    expect(currentSection('/admin/sessions/x')).toBe('/admin');
    expect(currentSection('/admin/questions')).toBe('/admin/questions');
    expect(currentSection('/admin/questions/x')).toBe('/admin/questions');
    expect(currentSection('/admin/questionsx')).toBe('/admin');
  });
});
