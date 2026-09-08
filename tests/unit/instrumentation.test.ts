/**
 * AD-9 — la ligne « échec du démarrage, sortie non nulle, aucun serveur lancé »
 * de la matrice repose sur `register()` et `ensureConfiguration()`. Sans ce
 * test, ce chemin ne serait exercé par rien.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// `startup.ts` écrit sur le descripteur 2 sans passer par `console` : c'est
// justement ce qui garantit que le message n'est pas tronqué à la sortie.
const {writeSyncMock} = vi.hoisted(() => ({writeSyncMock: vi.fn()}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {...actual, writeSync: writeSyncMock};
});

const savedEnv = {...process.env};

/** Ce qui a été écrit sur stderr. */
function stderrOutput(): string {
  return writeSyncMock.mock.calls
    .filter((call) => call[0] === 2)
    .map((call) => String(call[1]))
    .join('');
}

/** Empêche la sortie réelle du processus de test, et retient l'appel. */
function spyOnExit() {
  return vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
}

beforeEach(() => {
  vi.resetModules();
  writeSyncMock.mockClear();
  process.env.NEXT_RUNTIME = 'nodejs';
  process.exitCode = 0;
});

afterEach(() => {
  process.env = {...savedEnv};
  process.exitCode = 0;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('register', () => {
  it('arrête le processus avec un code non nul quand une variable requise manque', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    // Le message doit nommer la variable, sinon l'exploitant cherche à l'aveugle.
    expect(stderrOutput()).toContain('ANTHROPIC_API_KEY');
  });

  it('laisse démarrer quand la configuration est complète', async () => {
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(stderrOutput()).toBe('');
  });

  it('ne fait rien hors du runtime Node', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.NEXT_RUNTIME = 'edge';
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

describe('ensureConfiguration', () => {
  it('écrit la cause de façon synchrone avant de sortir', async () => {
    delete process.env.CONTENT_DIR;
    const exit = spyOnExit();

    const {ensureConfiguration} = await import('@/lib/startup');
    await ensureConfiguration();

    expect(stderrOutput()).toContain('CONTENT_DIR');
    expect(process.exitCode).toBe(1);
    // L'écriture précède la sortie : sur un flux redirigé, l'inverse tronquerait.
    expect(writeSyncMock.mock.invocationCallOrder[0]!).toBeLessThan(
      exit.mock.invocationCallOrder[0]!
    );
  });
});
