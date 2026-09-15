/**
 * AD-9 — toute la configuration vient de l'environnement, validée au démarrage.
 * Cas de la matrice : « Variable requise absente → échec du démarrage, message
 * nommant la variable ».
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseEnv, type EnvSource} from '@/env';

const COMPLETE: EnvSource = {
  ANTHROPIC_API_KEY: 'cle-de-test-sans-valeur',
  CONTENT_DIR: '/chemin/fictif/content',
  DATA_DIR: '/chemin/fictif/data',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  HOSTNAME: '127.0.0.1',
  PORT: '3000',
  ADMIN_DEV: '0'
};

describe('parseEnv', () => {
  it('accepte une configuration complète et la renvoie typée', () => {
    const env = parseEnv(COMPLETE);

    expect(env.ANTHROPIC_API_KEY).toBe('cle-de-test-sans-valeur');
    expect(env.CONTENT_DIR).toBe('/chemin/fictif/content');
    expect(env.DATA_DIR).toBe('/chemin/fictif/data');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://127.0.0.1:3000');
    expect(env.PORT).toBe(3000);
    expect(env.ADMIN_DEV).toBe(false);
  });

  it("n'expose que les sept clés du contrat de configuration", () => {
    expect(Object.keys(parseEnv(COMPLETE)).sort()).toEqual(
      [
        'ADMIN_DEV',
        'ANTHROPIC_API_KEY',
        'CONTENT_DIR',
        'DATA_DIR',
        'HOSTNAME',
        'NEXT_PUBLIC_SITE_URL',
        'PORT'
      ].sort()
    );
  });

  it('applique les valeurs par défaut des variables facultatives', () => {
    const env = parseEnv({
      ...COMPLETE,
      HOSTNAME: undefined,
      PORT: undefined,
      ADMIN_DEV: undefined
    });

    expect(env.HOSTNAME).toBe('127.0.0.1');
    expect(env.PORT).toBe(3000);
    expect(env.ADMIN_DEV).toBe(false);
  });

  it('lit ADMIN_DEV=1 comme un booléen vrai', () => {
    expect(parseEnv({...COMPLETE, ADMIN_DEV: '1'}).ADMIN_DEV).toBe(true);
  });

  it.each(['ANTHROPIC_API_KEY', 'CONTENT_DIR', 'DATA_DIR', 'NEXT_PUBLIC_SITE_URL'] as const)(
    'échoue en nommant %s quand la variable est absente',
    (name) => {
      expect(() => parseEnv({...COMPLETE, [name]: undefined})).toThrowError(new RegExp(name));
    }
  );

  it.each(['ANTHROPIC_API_KEY', 'CONTENT_DIR', 'DATA_DIR'] as const)(
    'échoue en nommant %s quand la variable est vide',
    (name) => {
      expect(() => parseEnv({...COMPLETE, [name]: ''})).toThrowError(new RegExp(name));
    }
  );

  it.each(['tests/fixtures/content', './content', '../content', 'content'])(
    'refuse un CONTENT_DIR relatif comme « %s »',
    (value) => {
      // `server.js` du build autonome se place dans `.next/standalone` avant de
      // démarrer : un chemin relatif y désigne un répertoire inexistant, et
      // l'erreur — « cv.yaml absent » — ne dit rien du vrai problème.
      expect(() => parseEnv({...COMPLETE, CONTENT_DIR: value})).toThrowError(/CONTENT_DIR/);
    }
  );

  it.each(['tests/fixtures/data', './data', '../data', 'data'])(
    'refuse un DATA_DIR relatif comme « %s », pour la même raison',
    (value) => {
      expect(() => parseEnv({...COMPLETE, DATA_DIR: value})).toThrowError(/DATA_DIR/);
    }
  );

  it('refuse une URL de site qui n’est pas absolue', () => {
    expect(() => parseEnv({...COMPLETE, NEXT_PUBLIC_SITE_URL: 'cv.exemple.invalid'})).toThrowError(
      /NEXT_PUBLIC_SITE_URL/
    );
  });

  it('refuse un PORT qui n’est pas un entier valide', () => {
    expect(() => parseEnv({...COMPLETE, PORT: 'trois-mille'})).toThrowError(/PORT/);
    expect(() => parseEnv({...COMPLETE, PORT: '70000'})).toThrowError(/PORT/);
  });

  it("refuse une valeur d'ADMIN_DEV hors du couple 0 / 1", () => {
    expect(() => parseEnv({...COMPLETE, ADMIN_DEV: 'true'})).toThrowError(/ADMIN_DEV/);
  });
});

describe('chargement du module', () => {
  const saved = {...process.env};

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = {...saved};
    vi.resetModules();
  });

  it('expose la configuration validée quand l’environnement est complet', async () => {
    const {env} = await import('@/env');
    expect(env.HOSTNAME).toBe('127.0.0.1');
  });

  it('fait échouer le démarrage quand une variable requise manque', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(import('@/env')).rejects.toThrowError(/ANTHROPIC_API_KEY/);
  });
});
