/**
 * AD-9 — la ligne « échec du démarrage, sortie non nulle, aucun serveur lancé »
 * de la matrice repose sur `register()` et `ensureConfiguration()`. Sans ce
 * test, ce chemin ne serait exercé par rien.
 */
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

afterEach(async () => {
  // Le journal vit sur `globalThis` et survit à `vi.resetModules()` : le
  // refermer ici, quoi qu'il soit arrivé au test, sinon une assertion qui
  // échoue laisserait la connexion ouverte et les cas suivants échoueraient
  // en cascade sur « déjà ouvert ». Modules neufs et environnement restauré
  // d'abord : `db.ts` charge `@/env`, que le test vient peut-être de casser.
  // La connaissance vit là aussi : oubliée, sinon un cas verrait celle d'un autre contenu.
  vi.resetModules();
  process.env = {...savedEnv};
  const {closeJournal} = await import('@/journal/db');
  closeJournal();
  const {resetKnowledge} = await import('@/knowledge');
  resetKnowledge();
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

  it('laisse démarrer quand la configuration est complète, le journal ouvert', async () => {
    // Un `DATA_DIR` neuf : `usage.db` ne peut y exister que si l'amorçage l'a créé.
    const dataDir = mkdtempSync(join(tmpdir(), 'cv-data-instr-'));
    process.env.DATA_DIR = dataDir;
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(stderrOutput()).toBe('');
    expect(existsSync(join(dataDir, 'usage.db'))).toBe(true);
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

describe('contenu invalide au démarrage', () => {
  it('arrête le processus en nommant le fichier et l’entrée fautive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cv-content-instr-'));
    // `finally` : une assertion qui échoue ne doit pas laisser un répertoire
    // temporaire de plus derrière elle à chaque exécution de la suite.
    try {
      // Un `cv.yaml` amputé de ce que le schéma exige, à côté d'un corpus valide.
      writeFileSync(join(dir, 'cv.yaml'), 'identite:\n  prenom: Camille\n', 'utf8');
      writeFileSync(
        join(dir, 'qa.fr.md'),
        '#### `abc-01` — Question ?\n**Réponse :**\nCorps.\n',
        'utf8'
      );
      process.env.CONTENT_DIR = dir;
      const exit = spyOnExit();

      const {register} = await import('@/instrumentation');
      await register();

      expect(exit).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderrOutput()).toContain('cv.yaml');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("n'essaie même pas de charger le contenu si la configuration est invalide", async () => {
    delete process.env.CONTENT_DIR;
    spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    // Un seul message : celui de la configuration, pas deux échecs empilés.
    expect(stderrOutput()).toContain('CONTENT_DIR');
    expect(stderrOutput()).not.toContain('cv.yaml');
  });
});

describe('connaissance au démarrage', () => {
  it('construit le noyau et lʼindex des deux langues, et journalise leurs tailles — jamais un texte', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cv-data-instr-'));
    process.env.DATA_DIR = dataDir;
    const exit = spyOnExit();
    const informe = vi.spyOn(console, 'info').mockImplementation(() => {});

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).not.toHaveBeenCalled();
    const lignes = informe.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((ligne) => ligne.event === 'knowledge.ready');
    expect(lignes.map((ligne) => ligne.lang)).toEqual(['fr', 'en']);
    for (const ligne of lignes) {
      expect(ligne).toMatchObject({level: 'info', corpusLang: ligne.lang, coreChars: expect.any(Number)});
      expect(JSON.stringify(ligne)).not.toContain('Sentinelle');
    }
    // La connaissance est construite : le noyau est prêt pour la première question.
    const {core} = await import('@/knowledge');
    expect(core('fr').length).toBe(lignes[0]!.coreChars);
  });

  it('arrête le processus quand lʼindex ne peut pas se construire, sans ouvrir le journal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cv-data-instr-'));
    process.env.DATA_DIR = dataDir;
    vi.doMock('@/knowledge', () => ({
      ensureKnowledge: () => {
        throw new Error('index de connaissance impossible (simulé)');
      }
    }));
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderrOutput()).toContain('index de connaissance impossible');
    // Le journal n'a pas été ouvert : le premier échec arrête tout.
    expect(existsSync(join(dataDir, 'usage.db'))).toBe(false);
    vi.doUnmock('@/knowledge');
  });

  it("n'essaie pas de construire l'index si le contenu est invalide", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cv-content-instr-'));
    try {
      writeFileSync(join(dir, 'cv.yaml'), 'identite:\n  prenom: Camille\n', 'utf8');
      writeFileSync(join(dir, 'qa.fr.md'), '#### `abc-01` — Question ?\n**Réponse :**\nCorps.\n', 'utf8');
      process.env.CONTENT_DIR = dir;
      spyOnExit();
      const informe = vi.spyOn(console, 'info').mockImplementation(() => {});

      const {register} = await import('@/instrumentation');
      await register();

      expect(stderrOutput()).toContain('cv.yaml');
      expect(informe.mock.calls.some((call) => String(call[0]).includes('knowledge.ready'))).toBe(false);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('journal au démarrage', () => {
  it('arrête le processus avec un message explicite quand DATA_DIR nʼexiste pas', async () => {
    const absent = join(tmpdir(), 'cv-data-inexistant-' + Date.now());
    process.env.DATA_DIR = absent;
    const exit = spyOnExit();

    const {register} = await import('@/instrumentation');
    await register();

    expect(exit).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    // Le message nomme la variable et le répertoire : l'exploitant sait quoi corriger.
    expect(stderrOutput()).toContain('DATA_DIR');
    expect(stderrOutput()).toContain(absent);
  });

  it("n'essaie pas d'ouvrir le journal si le contenu est invalide", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cv-content-instr-'));
    try {
      writeFileSync(join(dir, 'cv.yaml'), 'identite:\n  prenom: Camille\n', 'utf8');
      writeFileSync(join(dir, 'qa.fr.md'), '#### `abc-01` — Question ?\n**Réponse :**\nCorps.\n', 'utf8');
      process.env.CONTENT_DIR = dir;
      process.env.DATA_DIR = join(tmpdir(), 'cv-data-inexistant-' + Date.now());
      spyOnExit();

      const {register} = await import('@/instrumentation');
      await register();

      // Le premier échec arrête tout : un seul message, celui du contenu.
      expect(stderrOutput()).toContain('cv.yaml');
      expect(stderrOutput()).not.toContain('DATA_DIR');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('ANTHROPIC_BASE_URL au démarrage', () => {
  it('est dite quand elle est là — lʼhôte seulement, jamais la clé', async () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3901/v1';
    process.env.ANTHROPIC_API_KEY = 'cle-sentinelle-jamais-journalisee';
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyOnExit();

    const {ensureConfiguration} = await import('@/lib/startup');
    expect(await ensureConfiguration()).toBe(true);

    const lignes = avertit.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lignes).toEqual([expect.objectContaining({level: 'warn', event: 'config.model_base_url', host: '127.0.0.1:3901'})]);
    expect(JSON.stringify(lignes)).not.toContain('cle-sentinelle');
  });

  it('ne dit rien quand elle est absente : le SDK vise lʼAPI réelle', async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const avertit = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyOnExit();

    const {ensureConfiguration} = await import('@/lib/startup');
    expect(await ensureConfiguration()).toBe(true);

    expect(avertit.mock.calls.some((call) => String(call[0]).includes('config.model_base_url'))).toBe(false);
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
