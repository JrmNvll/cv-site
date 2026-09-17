/**
 * AD-6 — le limiteur : trois fenêtres glissantes, bloquantes, consommées
 * ensemble ou pas du tout, et un état qui survit aux copies du module.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LIMITS, limiterSizes, resetLimiter, take} from '@/agent/limiter';
import {UNKNOWN_CLIENT_IP} from '@/lib/client-ip';

const T0 = new Date('2026-09-15T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

beforeEach(() => {
  resetLimiter();
});

afterEach(() => {
  resetLimiter();
});

describe('les seuils', () => {
  it('sont ceux du squelette : 10 / 15 min par visiteur et par adresse, 60 / h pour le site', () => {
    expect(LIMITS).toEqual({
      visitor: {max: 10, windowMs: 15 * MIN},
      ip: {max: 10, windowMs: 15 * MIN},
      site: {max: 60, windowMs: 60 * MIN}
    });
  });
});

describe('par visiteur', () => {
  it('laisse passer dix questions en quinze minutes, refuse la onzième, et rouvre quand la première sort de la fenêtre', () => {
    for (let n = 0; n < 10; n += 1) {
      expect(take({visitorId: 'v1', ip: `203.0.113.${n}`, now: at(n * MIN)})).toBe(true);
    }
    // La onzième, à la 14e minute : refusée.
    expect(take({visitorId: 'v1', ip: '203.0.113.99', now: at(14 * MIN)})).toBe(false);
    // À la 15e minute, la première (t = 0) est sortie : une place se libère.
    expect(take({visitorId: 'v1', ip: '203.0.113.99', now: at(15 * MIN)})).toBe(true);
    expect(take({visitorId: 'v1', ip: '203.0.113.99', now: at(15 * MIN)})).toBe(false);
  });

  it('ne compte pas un visiteur pour un autre', () => {
    for (let n = 0; n < 10; n += 1) take({visitorId: 'v1', ip: `203.0.113.${n}`, now: T0});
    expect(take({visitorId: 'v1', ip: '203.0.113.50', now: T0})).toBe(false);
    expect(take({visitorId: 'v2', ip: '203.0.113.50', now: T0})).toBe(true);
  });
});

describe('par adresse', () => {
  it('bloque la onzième question dʼune même adresse, quel que soit le visiteur', () => {
    for (let n = 0; n < 10; n += 1) {
      expect(take({visitorId: `v${n}`, ip: '198.51.100.9', now: T0})).toBe(true);
    }
    expect(take({visitorId: 'v-autre', ip: '198.51.100.9', now: T0})).toBe(false);
    expect(take({visitorId: 'v-autre', ip: '198.51.100.10', now: T0})).toBe(true);
  });
});

describe('adresse inconnue (production sans X-Client-IP)', () => {
  it('nʼapplique pas la fenêtre dʼadresse : visiteur et site protègent seuls', () => {
    // Sans en-tête, tout le site partagerait « unknown » : dix questions pour
    // tout le monde. Ici, vingt visiteurs passent, chacun sous sa propre fenêtre.
    for (let n = 0; n < 20; n += 1) {
      expect(take({visitorId: `v${n}`, ip: UNKNOWN_CLIENT_IP, now: T0})).toBe(true);
    }
    expect(limiterSizes().ips).toBe(0);
    // La fenêtre du visiteur, elle, tient toujours.
    for (let n = 0; n < 10; n += 1) take({visitorId: 'v-seul', ip: UNKNOWN_CLIENT_IP, now: T0});
    expect(take({visitorId: 'v-seul', ip: UNKNOWN_CLIENT_IP, now: T0})).toBe(false);
    // Et celle du site aussi : 30 passées, 30 de plus, puis non.
    for (let n = 0; n < 30; n += 1) expect(take({visitorId: `w${n}`, ip: UNKNOWN_CLIENT_IP, now: T0})).toBe(true);
    expect(take({visitorId: 'w-neuf', ip: UNKNOWN_CLIENT_IP, now: T0})).toBe(false);
  });
});

describe('pour le site', () => {
  it('bloque la 61e question de lʼheure, toutes adresses et tous visiteurs confondus', () => {
    for (let n = 0; n < 60; n += 1) {
      expect(take({visitorId: `v${n}`, ip: `10.0.${Math.floor(n / 250)}.${n % 250}`, now: at(n * 1000)})).toBe(true);
    }
    expect(take({visitorId: 'v-neuf', ip: '10.9.9.9', now: at(60_000)})).toBe(false);
    // Une heure après la première : une place.
    expect(take({visitorId: 'v-neuf', ip: '10.9.9.9', now: at(60 * MIN)})).toBe(true);
  });
});

describe('tout ou rien', () => {
  it('ne consomme aucune fenêtre quand lʼune refuse', () => {
    // Le site est plein ; un visiteur neuf, une adresse neuve.
    for (let n = 0; n < 60; n += 1) take({visitorId: `v${n}`, ip: `10.0.0.${n}`, now: T0});
    expect(take({visitorId: 'v-neuf', ip: '10.9.9.9', now: T0})).toBe(false);

    // Une heure plus tard, le site est vide : le visiteur et l'adresse refusés
    // n'ont rien consommé — dix places entières, pas neuf.
    for (let n = 0; n < 10; n += 1) {
      expect(take({visitorId: 'v-neuf', ip: '10.9.9.9', now: at(60 * MIN)})).toBe(true);
    }
    expect(take({visitorId: 'v-neuf', ip: '10.9.9.9', now: at(60 * MIN)})).toBe(false);
  });

  it('une adresse pleine ne consomme pas la fenêtre du visiteur, ni celle du site', () => {
    for (let n = 0; n < 10; n += 1) take({visitorId: `v${n}`, ip: '198.51.100.9', now: T0});
    for (let n = 0; n < 5; n += 1) {
      expect(take({visitorId: 'v-x', ip: '198.51.100.9', now: T0})).toBe(false);
    }
    // Le visiteur garde ses dix places, sur une autre adresse.
    for (let n = 0; n < 10; n += 1) {
      expect(take({visitorId: 'v-x', ip: '198.51.100.10', now: T0})).toBe(true);
    }
    expect(take({visitorId: 'v-x', ip: '198.51.100.10', now: T0})).toBe(false);
  });
});

describe('une horloge qui recule', () => {
  it('ne glisse pas un instant ancien après un récent : la fenêtre se vide quand même', () => {
    for (let n = 0; n < 9; n += 1) take({visitorId: 'v1', ip: '203.0.113.1', now: at(n * MIN)});
    // L'horloge recule de dix minutes ; la dixième question est retenue à l'instant le plus récent, pas au passé.
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: at(-2 * MIN)})).toBe(true);
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: at(8 * MIN)})).toBe(false);
    // Quinze minutes après la première : une place — la fenêtre s'est bien vidée par le début.
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: at(15 * MIN)})).toBe(true);
    // Et l'instant reculé n'a pas figé la fenêtre : à t = 24 min, il reste au plus 9 des dix instants récents.
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: at(24 * MIN)})).toBe(true);
  });
});

describe('le balayage', () => {
  it('oublie les clés vides dès que la carte dépasse mille clés', () => {
    // Un refus ne crée pas de clé : le site plein (60/h), les 1 040 autres ne laissent rien.
    for (let n = 0; n < 1100; n += 1) take({visitorId: `v${n}`, ip: `10.${Math.floor(n / 250)}.${n % 250}.1`, now: T0});
    expect(limiterSizes().visitors).toBe(60);
    expect(limiterSizes().ips).toBe(60);
    resetLimiter();

    // 1 025 visiteurs distincts, un par minute (sous 60/h) : la carte grandit
    // jusqu'au seuil sans être balayée — c'est le seuil qui déclenche.
    const PAS = 61_000;
    for (let n = 0; n < 1025; n += 1) {
      expect(take({visitorId: `v${n}`, ip: `10.${Math.floor(n / 250)}.${n % 250}.1`, now: at(n * PAS)})).toBe(true);
    }
    expect(limiterSizes().visitors).toBe(1025);
    expect(limiterSizes().ips).toBe(1025);

    // La question suivante balaie : ne restent que les clés dont la fenêtre n'est pas vide — le dernier quart d'heure.
    expect(take({visitorId: 'v-tard', ip: '10.9.9.9', now: at(1025 * PAS)})).toBe(true);
    const {visitors, ips} = limiterSizes();
    expect(visitors).toBeLessThanOrEqual(Math.ceil(LIMITS.visitor.windowMs / PAS) + 1);
    expect(visitors).toBeGreaterThan(1);
    expect(ips).toBe(visitors);
  });
});

describe('lʼétat', () => {
  it('survit à une nouvelle copie du module : une seule porte globalThis', async () => {
    for (let n = 0; n < 10; n += 1) take({visitorId: 'v1', ip: '203.0.113.1', now: T0});
    vi.resetModules();
    const copie = await import('@/agent/limiter');

    expect(copie.take({visitorId: 'v1', ip: '203.0.113.2', now: T0})).toBe(false);
    copie.resetLimiter();
    expect(take({visitorId: 'v1', ip: '203.0.113.2', now: T0})).toBe(true);
  });

  it('repart de zéro après resetLimiter — ce quʼun redémarrage fait aussi', () => {
    for (let n = 0; n < 10; n += 1) take({visitorId: 'v1', ip: '203.0.113.1', now: T0});
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: T0})).toBe(false);
    resetLimiter();
    expect(take({visitorId: 'v1', ip: '203.0.113.1', now: T0})).toBe(true);
  });

  it('prend lʼinstant courant par défaut, et refuse une date invalide', () => {
    expect(take({visitorId: 'v1', ip: '203.0.113.1'})).toBe(true);
    expect(() => take({visitorId: 'v1', ip: '203.0.113.1', now: new Date('pas une date')})).toThrowError(
      TypeError
    );
  });
});
