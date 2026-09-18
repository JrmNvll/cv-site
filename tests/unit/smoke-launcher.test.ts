/**
 * `scripts/smoke.mjs` (story 11) — le lanceur du test de fumée, prouvé en
 * **sous-processus**, dans le style de `start.test.ts` : les refus avant tout
 * lancement (code 2 et l'usage), puis trois vrais lancements de Playwright,
 * restreints par `-g` à un seul test qui n'ouvre aucun navigateur (fixture
 * `request`) : contre un port fermé, le test `/admin*` s'exécute et échoue en
 * mode proxy (code non nul, `unexpected` dans le rapport JSON) et se saute sans
 * le mode (code 0, `skipped`, le message de fin nomme le saut) ; contre un
 * serveur minimal sans photo, le test de la photo se saute lui-même et le
 * lanceur, en mode proxy, sort quand même en 1. Moins de trois secondes.
 */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LANCEUR = join(ROOT, 'scripts', 'smoke.mjs');
/** Un port fermé : toute requête échoue sur-le-champ, rien ne sort du poste. */
const PORT_FERME = 'http://127.0.0.1:9';
const CONTROLEES = ['SMOKE_BASE_URL', 'SMOKE_BEHIND_PROXY', 'SMOKE_JSON_REPORT'];

type Rapport = {
  stats: {expected: number; unexpected: number; skipped: number};
  suites: Suite[];
};
type Suite = {title: string; specs: {title: string; tests: {status: string}[]}[]; suites?: Suite[]};

let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'cv-site-smoke-launcher-'));
});

afterEach(() => {
  rmSync(dossier, {recursive: true, force: true});
});

/**
 * Lance le lanceur — de façon **asynchrone** : le dernier test tient un serveur
 * HTTP dans ce processus, qu'un `spawnSync` empêcherait de répondre.
 */
function lancer(args: string[], env: Record<string, string> = {}): Promise<{status: number | null; stdout: string; stderr: string}> {
  const base: NodeJS.ProcessEnv = {...process.env};
  for (const cle of CONTROLEES) delete base[cle];
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, [LANCEUR, ...args], {cwd: ROOT, env: {...base, ...env}});
    let stdout = '';
    let stderr = '';
    enfant.stdout.setEncoding('utf8').on('data', (morceau: string) => (stdout += morceau));
    enfant.stderr.setEncoding('utf8').on('data', (morceau: string) => (stderr += morceau));
    enfant.on('error', reject);
    enfant.on('close', (status) => resolve({status, stdout, stderr}));
  });
}

/** Tous les tests du rapport, à plat : titre du spec et statut. */
function tests(suite: Suite, trouves: {titre: string; status: string}[] = []): {titre: string; status: string}[] {
  for (const spec of suite.specs) for (const test of spec.tests) trouves.push({titre: spec.title, status: test.status});
  for (const sous of suite.suites ?? []) tests(sous, trouves);
  return trouves;
}

describe('scripts/smoke.mjs — refus avant tout lancement', () => {
  const cas: [string, string[], Record<string, string>, string][] = [
    ['sans URL', [], {}, 'aucune URL cible'],
    ['URL invalide', ['--base-url', 'pas-une-url'], {}, "n'est pas une URL"],
    ['schéma ftp', ['--base-url=ftp://exemple.invalid'], {}, 'http ou https'],
    ['--base-url= vide, même avec SMOKE_BASE_URL', ['--base-url='], {SMOKE_BASE_URL: PORT_FERME}, 'vide'],
    ['SMOKE_BEHIND_PROXY=yes', ['--base-url', PORT_FERME], {SMOKE_BEHIND_PROXY: 'yes'}, 'SMOKE_BEHIND_PROXY']
  ];
  for (const [nom, args, env, attendu] of cas) {
    it(`refuse ${nom} : code 2, message et usage, sans lancer Playwright`, async () => {
      const resultat = await lancer(args, env);
      expect(resultat.status).toBe(2);
      expect(resultat.stderr).toContain('Test de fumée refusé');
      expect(resultat.stderr).toContain(attendu);
      expect(resultat.stderr).toContain('Usage : npm run test:smoke');
      expect(resultat.stdout).not.toContain('Running');
    });
  }
});

describe('scripts/smoke.mjs — un lancement réel contre un port fermé', () => {
  it('en mode proxy, le test /admin* sʼexécute et échoue : code non nul, unexpected — pas skipped', async () => {
    const rapport = join(dossier, 'rapport.json');
    const resultat = await lancer(['--base-url', PORT_FERME, '--behind-proxy', '-g', '401'], {SMOKE_JSON_REPORT: rapport});

    expect(resultat.status).not.toBe(0);
    expect(resultat.status).not.toBe(2);
    expect(existsSync(rapport), 'le rapport JSON demandé est conservé').toBe(true);
    const json = JSON.parse(readFileSync(rapport, 'utf8')) as Rapport;
    const admin = json.suites.flatMap((suite) => tests(suite)).filter(({titre}) => titre.includes('401'));
    expect(admin).toHaveLength(1);
    expect(admin[0]!.status).toBe('unexpected');
    expect(json.stats.skipped).toBe(0);
    expect(resultat.stdout).toContain('Mode : derrière Caddy');
  });

  it('sans le mode proxy, le même test est sauté : code 0, skipped, et le message de fin le nomme', async () => {
    const rapport = join(dossier, 'rapport.json');
    const resultat = await lancer(['--base-url', PORT_FERME, '-g', '401'], {SMOKE_JSON_REPORT: rapport});

    expect(resultat.status).toBe(0);
    const json = JSON.parse(readFileSync(rapport, 'utf8')) as Rapport;
    const admin = json.suites.flatMap((suite) => tests(suite)).filter(({titre}) => titre.includes('401'));
    expect(admin).toHaveLength(1);
    expect(admin[0]!.status).toBe('skipped');
    expect(json.stats.skipped).toBe(1);
    expect(resultat.stdout).toContain('1 vérification(s) attendent le proxy');
    expect(resultat.stdout).toContain('sans identifiants répond 401');
    expect(resultat.stdout).toContain('attend le proxy : SMOKE_BEHIND_PROXY=1');
  });

  it('en mode proxy, un test sauté vaut échec même quand Playwright sort en 0', async () => {
    // Un serveur minimal qui répond une page sans photo : le test de la photo
    // se saute lui-même (`test.skip`), Playwright sort en 0 — et le lanceur,
    // en mode proxy, doit quand même sortir en 1 et nommer le saut.
    const serveur = createServer((_requete, reponse) => {
      reponse.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      reponse.end('<!doctype html><html lang="fr"><head><meta name="robots" content="noindex, nofollow"></head><body>sans photo</body></html>');
    });
    await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
    const {port} = serveur.address() as AddressInfo;
    try {
      const rapport = join(dossier, 'rapport.json');
      const resultat = await lancer([`--base-url=http://127.0.0.1:${port}`, '--behind-proxy', '-g', 'photo'], {SMOKE_JSON_REPORT: rapport});

      const json = JSON.parse(readFileSync(rapport, 'utf8')) as Rapport;
      expect(json.stats.unexpected).toBe(0);
      expect(json.stats.skipped).toBe(1);
      expect(resultat.status).toBe(1);
      expect(resultat.stderr).toContain('Mode proxy : 1 vérification(s) sautée(s), ce qui vaut échec');
      expect(resultat.stderr).toContain('le contenu ne déclare pas de photo');
    } finally {
      await new Promise<void>((resolve) => serveur.close(() => resolve()));
    }
  });
});
