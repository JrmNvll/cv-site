/**
 * `start.mjs` (story 11) — le démarrage que le service Windows exécute, prouvé
 * en **sous-processus** : le vrai fichier, copié dans un dossier temporaire à
 * côté d'un artefact factice (`.next/standalone/server.js` qui écrit
 * l'environnement qu'il reçoit, et `.next/standalone/.next/static`). Ce qui
 * est prouvé : la précédence de l'environnement sur `.env.local` (une variable
 * vide comptant pour absente), `HOSTNAME` forcé à la boucle locale, l'absence
 * du fichier tolérée sans bruit, une erreur de lecture fatale — avant tout
 * import de l'artefact —, la marque d'ordre des octets retirée, l'UTF-16
 * refusé avec le remède, `ANTHROPIC_BASE_URL` du fichier refusé sous le
 * service, l'avertissement hors boucle locale, `START_SKIP_ENV_FILE`,
 * l'artefact absent ou incomplet refusé.
 */
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const START = fileURLToPath(new URL('../../start.mjs', import.meta.url));
const BOM = String.fromCharCode(0xfeff);

/** Ce que le `server.js` factice écrit : les variables qui comptent, telles qu'il les voit. */
type Vu = {HOSTNAME?: string; PORT?: string; DU_FICHIER?: string; DES_DEUX?: string; ANTHROPIC_BASE_URL?: string};

const FAUX_SERVEUR = `
process.stdout.write('SERVEUR ' + JSON.stringify({
  HOSTNAME: process.env.HOSTNAME,
  PORT: process.env.PORT,
  DU_FICHIER: process.env.DU_FICHIER,
  DES_DEUX: process.env.DES_DEUX,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL
}));
`;

/**
 * Les variables que le test contrôle — retirées de l'environnement hérité :
 * `tests/setup-env.ts` pose `HOSTNAME`, `PORT` et `ANTHROPIC_BASE_URL` pour
 * les tests unitaires, Vitest pose `NODE_ENV`, et ils fausseraient la preuve.
 */
const CONTROLEES = ['HOSTNAME', 'PORT', 'DU_FICHIER', 'DES_DEUX', 'ANTHROPIC_BASE_URL', 'NODE_ENV', 'START_SKIP_ENV_FILE'];

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'cv-site-start-'));
  copyFileSync(START, join(racine, 'start.mjs'));
  mkdirSync(join(racine, '.next', 'standalone', '.next', 'static'), {recursive: true});
  writeFileSync(join(racine, '.next', 'standalone', 'server.js'), FAUX_SERVEUR);
});

afterEach(() => {
  rmSync(racine, {recursive: true, force: true});
});

/** Lance `node start.mjs` dans le dossier temporaire, avec l'environnement donné en plus de l'hérité épuré. */
function demarrer(env: Record<string, string> = {}) {
  const base: NodeJS.ProcessEnv = {...process.env};
  for (const cle of CONTROLEES) delete base[cle];
  const resultat = spawnSync(process.execPath, ['start.mjs'], {
    cwd: racine,
    env: {...base, ...env},
    encoding: 'utf8',
    timeout: 20_000
  });
  const marque = 'SERVEUR ';
  const debut = resultat.stdout.indexOf(marque);
  const vu = debut === -1 ? undefined : (JSON.parse(resultat.stdout.slice(debut + marque.length)) as Vu);
  const journal = resultat.stdout
    .split('\n')
    .filter((ligne) => ligne.startsWith('{'))
    .map((ligne) => JSON.parse(ligne) as Record<string, string>);
  return {status: resultat.status, stdout: resultat.stdout, stderr: resultat.stderr, vu, journal};
}

const envLocal = (contenu: string | Buffer) => writeFileSync(join(racine, '.env.local'), contenu);

describe('start.mjs', () => {
  it('charge .env.local, et lʼenvironnement gagne sur une variable en double', () => {
    envLocal('PORT=4444\nDU_FICHIER=fichier\nDES_DEUX=fichier\n');

    const {status, stderr, vu} = demarrer({PORT: '5555', DES_DEUX: 'environnement'});

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(vu).toMatchObject({PORT: '5555', DU_FICHIER: 'fichier', DES_DEUX: 'environnement'});
  });

  it('une variable présente mais vide dans lʼenvironnement vaut absente : le fichier la fournit', () => {
    envLocal('DU_FICHIER=fichier\nPORT=4444\n');

    expect(demarrer({DU_FICHIER: '', PORT: ''}).vu).toMatchObject({DU_FICHIER: 'fichier', PORT: '4444'});
  });

  it('force HOSTNAME à 127.0.0.1 quand rien ne le pose — absent ou vide', () => {
    envLocal('PORT=4444\n');

    expect(demarrer().vu).toMatchObject({HOSTNAME: '127.0.0.1', PORT: '4444'});
    // Vide vaut absent : `server.js` lirait sinon `0.0.0.0`.
    expect(demarrer({HOSTNAME: ''}).vu).toMatchObject({HOSTNAME: '127.0.0.1'});
  });

  it('respecte un HOSTNAME posé — par lʼenvironnement ou par .env.local', () => {
    envLocal('HOSTNAME=192.0.2.10\n');

    expect(demarrer().vu).toMatchObject({HOSTNAME: '192.0.2.10'});
    expect(demarrer({HOSTNAME: '192.0.2.20'}).vu).toMatchObject({HOSTNAME: '192.0.2.20'});
  });

  it('avertit, sans refuser, quand HOSTNAME sort de la boucle locale en production', () => {
    envLocal('HOSTNAME=0.0.0.0\n');

    const {status, vu, journal} = demarrer({NODE_ENV: 'production'});
    expect(status).toBe(0);
    expect(vu).toMatchObject({HOSTNAME: '0.0.0.0'});
    const avertissement = journal.find((ligne) => ligne.event === 'start.hostname_not_loopback');
    expect(avertissement).toMatchObject({level: 'warn', hostname: '0.0.0.0'});
    expect(avertissement!.text).toContain('AD-10');

    // Sur la boucle locale, ou hors production : rien.
    expect(demarrer({NODE_ENV: 'production', HOSTNAME: 'localhost'}).journal.map((l) => l.event)).not.toContain('start.hostname_not_loopback');
    expect(demarrer().journal.map((l) => l.event)).not.toContain('start.hostname_not_loopback');
  });

  it('tolère lʼabsence de .env.local, sans avertissement', () => {
    const {status, stdout, stderr, vu} = demarrer({PORT: '3000'});

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(vu).toMatchObject({HOSTNAME: '127.0.0.1', PORT: '3000'});
    // Une ligne de journal, structurée, qui dit ce qui a été fait — pas une valeur.
    const journal = JSON.parse(stdout.slice(0, stdout.indexOf('\n'))) as Record<string, string>;
    expect(journal).toMatchObject({level: 'info', event: 'start.environment', envFile: 'absent', hostname: '127.0.0.1', port: '3000'});
  });

  it('refuse de démarrer si .env.local existe mais ne se lit pas — avant dʼimporter lʼartefact', () => {
    // Un répertoire à sa place : la lecture échoue autrement que par ENOENT.
    mkdirSync(join(racine, '.env.local'));

    const {status, stderr, vu} = demarrer();

    expect(status).not.toBe(0);
    expect(stderr).toContain('Démarrage refusé');
    expect(stderr).toContain('.env.local');
    expect(vu, 'server.js ne doit pas avoir été importé').toBeUndefined();
  });

  it('retire la marque dʼordre des octets en tête de .env.local', () => {
    envLocal(`${BOM}DU_FICHIER=premiere-cle\nDES_DEUX=seconde\n`);

    expect(demarrer().vu).toMatchObject({DU_FICHIER: 'premiere-cle', DES_DEUX: 'seconde'});
  });

  it('refuse un .env.local en UTF-16 ou binaire, et dit le remède', () => {
    // Ce que `Out-File` et `>` de PowerShell 5.1 écrivent : UTF-16LE avec sa marque FF FE.
    envLocal(Buffer.from(`${BOM}DU_FICHIER=fichier\nPORT=4444\n`, 'utf16le'));
    const utf16 = demarrer();
    expect(utf16.status).not.toBe(0);
    expect(utf16.stderr).toContain('UTF-16');
    expect(utf16.stderr).toContain('Out-File -Encoding utf8');
    expect(utf16.vu).toBeUndefined();

    // UTF-16LE sans marque : des NUL entre les caractères.
    envLocal(Buffer.from('DU_FICHIER=fichier\n', 'utf16le'));
    const sansMarque = demarrer();
    expect(sansMarque.status).not.toBe(0);
    expect(sansMarque.stderr).toContain('UTF-16 ou binaire');
  });

  it('refuse ANTHROPIC_BASE_URL venu du fichier sous le service (NODE_ENV=production avant), pas de lʼenvironnement', () => {
    envLocal('ANTHROPIC_BASE_URL=http://127.0.0.1:9\n');
    const refus = demarrer({NODE_ENV: 'production'});
    expect(refus.status).not.toBe(0);
    expect(refus.stderr).toContain('ANTHROPIC_BASE_URL');
    expect(refus.stderr).toContain('simulateur');
    expect(refus.vu).toBeUndefined();

    // Hors service (pas de NODE_ENV=production avant) : le fichier passe.
    expect(demarrer().vu).toMatchObject({ANTHROPIC_BASE_URL: 'http://127.0.0.1:9'});
    // Ligne présente mais vide sur le serveur : tolérée.
    envLocal('ANTHROPIC_BASE_URL=\n');
    expect(demarrer({NODE_ENV: 'production'}).status).toBe(0);
    // Venue de l'environnement (tests navigateur) : pas concernée, même sous production.
    rmSync(join(racine, '.env.local'));
    const environnement = demarrer({NODE_ENV: 'production', ANTHROPIC_BASE_URL: 'http://127.0.0.1:3901'});
    expect(environnement.status).toBe(0);
    expect(environnement.vu).toMatchObject({ANTHROPIC_BASE_URL: 'http://127.0.0.1:3901'});
  });

  it('START_SKIP_ENV_FILE=1 ne lit pas le fichier du tout', () => {
    envLocal('DU_FICHIER=fichier\n');
    const saute = demarrer({START_SKIP_ENV_FILE: '1'});
    expect(saute.status).toBe(0);
    expect(saute.vu?.DU_FICHIER).toBeUndefined();
    expect(saute.journal[0]).toMatchObject({event: 'start.environment', envFile: 'skipped'});

    // Même un fichier illisible n'est pas touché.
    rmSync(join(racine, '.env.local'));
    mkdirSync(join(racine, '.env.local'));
    expect(demarrer({START_SKIP_ENV_FILE: '1'}).status).toBe(0);
  });

  it('refuse de démarrer sans artefact autonome, et dit quoi faire', () => {
    rmSync(join(racine, '.next'), {recursive: true, force: true});

    const {status, stderr, vu} = demarrer();

    expect(status).not.toBe(0);
    expect(stderr).toContain('npm run build');
    expect(vu).toBeUndefined();
  });

  it('refuse un artefact incomplet — .next/standalone/.next/static absent, postbuild non joué', () => {
    rmSync(join(racine, '.next', 'standalone', '.next'), {recursive: true, force: true});

    const {status, stderr, vu} = demarrer();

    expect(status).not.toBe(0);
    expect(stderr).toContain('postbuild');
    expect(stderr).toContain('npm run build');
    expect(vu).toBeUndefined();
  });
});
