/**
 * `npm run check:content` — valide le contenu **réel** désigné par `CONTENT_DIR`
 * et rapporte ce qu'il contient.
 *
 * Pourquoi hors de `npm run verify` : `verify` doit rester vert sur une machine
 * qui n'a pas le dépôt privé (AD-2). Ce script, lui, ne sert à rien sans lui —
 * il est l'outil de la boucle d'édition du contenu, pas de la vérification du
 * code. Il ne lit rien d'autre que le contenu, n'écrit rien, et n'affiche jamais
 * le corps d'une entrée.
 *
 * Usage :
 *   npm run check:content              (CONTENT_DIR pris dans l'env ou .env.local)
 *   npm run check:content -- <chemin>
 */
import {existsSync, readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Node sait retirer les types d'un `.ts`, mais pas résoudre un import sans
 * extension. Ce crochet le fait, et seulement pour ça : la couche `content`
 * garde le style du reste du dépôt plutôt que de se tordre pour un script.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier);
    const target = bare && existsSync(fileURLToPath(new URL(`${specifier}.ts`, context.parentURL)))
      ? `${specifier}.ts`
      : specifier;
    const resolved = nextResolve(target, context);
    // `format` explicite : sans lui, Node ré-analyse chaque `.ts` pour deviner
    // s'il est ESM et le dit bruyamment à chaque exécution.
    return target.endsWith('.ts') ? {...resolved, format: 'module-typescript'} : resolved;
  }
});

/** `CONTENT_DIR` : argument, environnement, puis `.env.local` — dans cet ordre. */
function contentDir() {
  const fromArgv = process.argv[2];
  if (fromArgv) return fromArgv;
  if (process.env.CONTENT_DIR) return process.env.CONTENT_DIR;

  const envFile = resolve(ROOT, '.env.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?CONTENT_DIR\s*=\s*(.*)$/.exec(line);
      if (match) {
        const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
        if (value) return value;
      }
    }
  }
  return null;
}

/** Compte les entrées par statut, sans jamais toucher à leur corps. */
function tally(entries) {
  const counts = {normale: 0, vide: 0, 'PRIVÉ': 0, PASSE: 0};
  let consignes = 0;
  let etoiles = 0;
  for (const entry of entries) {
    counts[entry.statut] += 1;
    if (entry.consigne !== null) consignes += 1;
    if (entry.etoile) etoiles += 1;
  }
  return {counts, consignes, etoiles};
}

function describeCorpus(file, entries) {
  if (entries.length === 0) return `  ${file.padEnd(10)} absent ou vide`;
  const {counts, consignes, etoiles} = tally(entries);
  const blocs = new Set(entries.map((entry) => entry.bloc?.titre ?? '(hors bloc)')).size;
  return [
    `  ${file.padEnd(10)} ${String(entries.length).padStart(3)} entrées`,
    `${blocs} blocs`,
    `normales ${counts.normale}`,
    `vides ${counts.vide}`,
    `PRIVÉ ${counts['PRIVÉ']}`,
    `PASSE ${counts.PASSE}`,
    `consignes ${consignes}`,
    `prioritaires ${etoiles}`
  ].join(' · ');
}

/** Toutes les clés de citation `cv:` que porte la projection `agent` (AD-4). */
function citationKeys(agent) {
  const keys = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    if (typeof node.source === 'string') keys.push(node.source);
  };
  Object.values(agent).forEach(walk);
  return keys;
}

/**
 * Champs bilingues dont une langue manque. `load.ts` les a déjà comptés à la
 * construction des projections ; on relit ici son avertissement, pour ne pas
 * refaire le calcul avec une autre définition du repli.
 */
function describeFallbacks(warnings, lang) {
  const marker = `« ${lang} »`;
  const line = warnings.find((warning) => warning.message.includes(marker));
  return line === undefined ? 'aucun' : line.message;
}

async function main() {
  const dir = contentDir();
  if (!dir) {
    console.error(
      'CONTENT_DIR est introuvable. Passer le chemin en argument :\n' +
        '  npm run check:content -- c:/chemin/vers/content'
    );
    process.exitCode = 1;
    return;
  }

  // `load.ts` plutôt que `src/content/index.ts` : la surface publique est liée à
  // `src/env.ts`, donc à `server-only` et aux sept variables de l'application. Cet
  // outil doit tourner avec `CONTENT_DIR` seul, et prend son répertoire en
  // argument. La frontière de couches, elle, vaut pour `scripts/` comme pour le
  // reste : voir `layers.config.mjs`.
  const {loadContent, formatIssue, ContentError} = await import('../src/content/load.ts');

  let result;
  try {
    result = loadContent(dir);
  } catch (error) {
    if (error instanceof ContentError) {
      console.error(`Contenu invalide dans ${resolve(dir)} — ${error.issues.length} anomalie(s) :`);
      for (const issue of error.issues) console.error(`  - ${formatIssue(issue)}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
    return;
  }

  const {content, warnings} = result;
  const agent = content.cv.agent.fr;
  const display = content.cv.display.fr;
  const keys = citationKeys(agent);

  console.log(`Contenu : ${content.dir}\n`);

  console.log('cv.yaml');
  console.log(
    `  ${agent.experiences.length} expériences · ` +
      `${agent.formation.length} formations (${display.formation.length} affichée(s)) · ` +
      `${agent.competences.length} catégories de compétences · ` +
      `${agent.certificats_travail.length} certificat(s) de travail`
  );
  console.log(
    `  photo : ${display.identite.photo ? 'présente' : 'absente'} · ` +
      `lettre de motivation : ${agent.lettre_motivation ? 'présente' : 'absente'}`
  );
  console.log(`  clés de citation cv: ${keys.length} — ${keys.join(', ')}`);

  for (const lang of ['fr', 'en']) {
    const missing = describeFallbacks(warnings, lang);
    console.log(`  champs sans version « ${lang} » : ${missing}`);
  }
  console.log('');

  console.log('Corpus question/réponse');
  console.log(describeCorpus('qa.fr.md', content.qa.fr));
  console.log(describeCorpus('qa.en.md', content.qa.en));

  const frenchIds = content.qa.fr.map((entry) => entry.id);
  const englishIds = new Set(content.qa.en.map((entry) => entry.id));
  const late = frenchIds.filter((id) => !englishIds.has(id));
  console.log(
    `  écarts d'identifiants : ${late.length === 0 ? 'aucun' : `${late.length} — ${late.join(', ')}`}` +
      ' (une entrée orpheline en anglais aurait fait échouer le chargement)\n'
  );

  if (warnings.length === 0) {
    console.log('Aucun avertissement.');
  } else {
    console.log(`Avertissements (${warnings.length}) :`);
    for (const warning of warnings) console.log(`  - ${formatIssue(warning)}`);
  }

  console.log('\nContenu valide.');
}

await main();
