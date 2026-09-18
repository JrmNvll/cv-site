/**
 * `scripts/postbuild.mjs` (story 11) — la copie qui rend l'artefact autonome
 * complet, prouvée en sous-processus sur un faux projet : `.next/static` et
 * `public/` recopiés dans `.next/standalone`, rejouable à l'identique (un
 * résidu d'une copie précédente disparaît), `public/` facultatif, et refus
 * quand le build n'a pas eu lieu.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const POSTBUILD = fileURLToPath(new URL('../../scripts/postbuild.mjs', import.meta.url));

let racine: string;
let standalone: string;

function ecrire(relatif: string, contenu: string): void {
  const chemin = join(racine, ...relatif.split('/'));
  mkdirSync(join(chemin, '..'), {recursive: true});
  writeFileSync(chemin, contenu);
}

/** Les fichiers sous un dossier, chemins relatifs en barres obliques, triés. */
function fichiers(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier, {recursive: true, withFileTypes: true})
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name).slice(dossier.length + 1).split('\\').join('/'))
    .sort();
}

function lancer() {
  return spawnSync(process.execPath, [POSTBUILD, racine], {encoding: 'utf8', timeout: 20_000});
}

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'cv-site-postbuild-'));
  standalone = join(racine, '.next', 'standalone');
  // Ce que `next build` laisse : l'artefact avec son serveur, et les statiques à côté.
  ecrire('.next/standalone/server.js', '// factice');
  ecrire('.next/static/chunks/app.js', 'chunk');
  ecrire('.next/static/css/site.css', 'css');
  ecrire('.next/static/media/photo.woff2', 'font');
});

afterEach(() => {
  rmSync(racine, {recursive: true, force: true});
});

describe('postbuild', () => {
  it('recopie .next/static et public/ dans lʼartefact', () => {
    ecrire('public/favicon.ico', 'icone');

    const resultat = lancer();

    expect(resultat.stderr).toBe('');
    expect(resultat.status).toBe(0);
    expect(fichiers(join(standalone, '.next', 'static'))).toEqual(['chunks/app.js', 'css/site.css', 'media/photo.woff2']);
    expect(fichiers(join(standalone, 'public'))).toEqual(['favicon.ico']);
    expect(readFileSync(join(standalone, '.next', 'static', 'css', 'site.css'), 'utf8')).toBe('css');
    // Le journal dit ce qui a été copié, et combien.
    expect(resultat.stdout).toContain('.next/static/ → .next/standalone/.next/static/ (3 fichiers)');
    expect(resultat.stdout).toContain('public/ → .next/standalone/public/ (1 fichiers)');
  });

  it('est rejouable : deux passages donnent le même artefact, sans résidu', () => {
    ecrire('public/favicon.ico', 'icone');
    expect(lancer().status).toBe(0);
    // Un résidu d'une copie précédente, et un fichier source remplacé entre-temps.
    ecrire('.next/standalone/.next/static/chunks/ancien.js', 'résidu');
    ecrire('.next/standalone/public/ancien.txt', 'résidu');
    ecrire('.next/static/css/site.css', 'css v2');

    expect(lancer().status).toBe(0);

    expect(fichiers(join(standalone, '.next', 'static'))).toEqual(['chunks/app.js', 'css/site.css', 'media/photo.woff2']);
    expect(fichiers(join(standalone, 'public'))).toEqual(['favicon.ico']);
    expect(readFileSync(join(standalone, '.next', 'static', 'css', 'site.css'), 'utf8')).toBe('css v2');
  });

  it('tolère lʼabsence de public/ — ce dépôt nʼen a pas', () => {
    const resultat = lancer();

    expect(resultat.status).toBe(0);
    expect(resultat.stderr).toBe('');
    expect(existsSync(join(standalone, 'public'))).toBe(false);
    expect(fichiers(join(standalone, '.next', 'static'))).toHaveLength(3);
    expect(resultat.stdout).toContain('public/ absent, rien à copier');
  });

  it('refuse sans .next/static : le build est incomplet', () => {
    rmSync(join(racine, '.next', 'static'), {recursive: true, force: true});

    const resultat = lancer();

    expect(resultat.status).not.toBe(0);
    expect(resultat.stderr).toContain('postbuild refusé');
    expect(resultat.stderr).toContain('.next/static');
  });

  it('refuse, en le nommant, un échec de copie — .next/standalone/.next est un fichier', () => {
    // La destination ne peut pas être créée : la copie échoue. Le refus nomme la
    // cible et le code, sans trace brute.
    ecrire('.next/standalone/.next', 'pas un dossier');

    const resultat = lancer();

    expect(resultat.status).not.toBe(0);
    expect(resultat.stderr).toContain('postbuild refusé');
    expect(resultat.stderr).toContain('.next/standalone/.next/static');
    expect(resultat.stderr).not.toContain('    at ');
  });

  it('refuse sans artefact autonome : next build dʼabord', () => {
    rmSync(standalone, {recursive: true, force: true});

    const resultat = lancer();

    expect(resultat.status).not.toBe(0);
    expect(resultat.stderr).toContain('server.js');
    expect(resultat.stderr).toContain('next build');
  });
});
