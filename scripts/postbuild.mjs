/**
 * `postbuild` — rend l'artefact autonome **complet** (AD-13, story 11).
 *
 * `next build` en `output: 'standalone'` écrit `.next/standalone/` avec
 * `server.js` et les seuls modules qu'il trace — mais **pas** `.next/static`
 * (les scripts et feuilles de style que les pages référencent) ni `public/`.
 * Servi tel quel, l'artefact rend des pages sans style dont chaque `<script>`
 * répond 404. npm enchaîne ce script à `npm run build` par son nom : sur le
 * VPS, `deploy.ps1` lance `npm run build` et n'a rien d'autre à savoir.
 *
 * La copie est un **miroir** : la destination est retirée puis recopiée, donc
 * rejouer le script donne exactement le même résultat, sans résidu d'un build
 * précédent. `public/` est facultatif — ce dépôt n'en a pas aujourd'hui — et
 * son absence n'est pas une erreur ; `.next/static` manquant ou `server.js`
 * absent le sont : le build n'a pas eu lieu, ou pas en autonome.
 *
 * Usage :
 *   npm run build                       (postbuild enchaîné par npm)
 *   node scripts/postbuild.mjs [racine] (racine : le dossier du projet, par défaut celui-ci)
 */
import {cpSync, existsSync, readdirSync, rmSync, statSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = resolve(ROOT, '.next', 'standalone');

/** Ce que l'artefact doit recevoir : source, destination, et si l'absence de la source est une erreur. */
const COPIES = [
  {from: resolve(ROOT, '.next', 'static'), to: resolve(STANDALONE, '.next', 'static'), required: true},
  {from: resolve(ROOT, 'public'), to: resolve(STANDALONE, 'public'), required: false}
];

function refuse(message) {
  console.error(`postbuild refusé — ${message}`);
  process.exit(1);
}

/** Nombre de fichiers sous un dossier, pour le journal. */
function countFiles(directory) {
  return readdirSync(directory, {recursive: true}).filter((entry) =>
    statSync(resolve(directory, String(entry))).isFile()
  ).length;
}

const show = (path) => relative(ROOT, path).split('\\').join('/');

if (!existsSync(resolve(STANDALONE, 'server.js'))) {
  refuse(`${show(STANDALONE)}/server.js absent : next build d'abord, en output: 'standalone'.`);
}

for (const {from, to, required} of COPIES) {
  if (!existsSync(from)) {
    if (required) refuse(`${show(from)} absent : le build est incomplet.`);
    console.log(`postbuild : ${show(from)}/ absent, rien à copier`);
    continue;
  }
  // Un échec de copie (droits, fichier à la place d'un dossier, disque) est
  // nommé, cible et code — pas une trace brute que `deploy.ps1` journaliserait telle quelle.
  try {
    rmSync(to, {recursive: true, force: true});
    cpSync(from, to, {recursive: true});
  } catch (error) {
    refuse(`${show(to)} : ${error && error.code ? error.code : 'échec'} — ${error && error.message ? error.message : String(error)}`);
  }
  console.log(`postbuild : ${show(from)}/ → ${show(to)}/ (${countFiles(to)} fichiers)`);
}
