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
 * S'il existe, le jeu de tests adverses (`tests/adversarial.yaml`, AD-12) est
 * compté et validé par le même schéma que le runner
 * (`tests/adversarial/schema.ts`) — et chaque source attendue doit exister
 * dans le contenu. Rien du jeu n'est affiché : ni une question, ni une annonce.
 *
 * Usage :
 *   npm run check:content              (CONTENT_DIR pris dans l'env ou .env.local)
 *   npm run check:content -- <chemin>
 */
import {existsSync, readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse as parseYaml} from 'yaml';

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

/** L'en-tête que `parseSuite` met devant ses anomalies, une par ligne. */
const SCHEMA_HEADER = /^Jeu de tests adverses invalide — \d+ anomalie\(s\) :\n/;

/**
 * Le jeu de tests adverses, s'il existe : validé par le schéma du runner, puis
 * confronté au contenu comme le runner le fait avant tout appel — chaque
 * source attendue ou tolérée existe et se cite dans la langue du cas (`qa:`
 * une entrée ordinaire, `cv:` une clé de la projection) ; chaque formulation
 * attendue est un fragment d'une entrée `sys-*` ou des règles fixes du prompt
 * (refus, renvoi), d'une consigne `PRIVÉ` ou d'une entrée `sys-*` (`private`).
 * Un corpus anglais vide renvoie au français, comme `knowledge` le fait.
 *
 * Les règles fixes sont **lues comme un texte** (`src/agent/prompts.ts`), pas
 * importées : l'outillage n'atteint pas la couche `agent` (`layers.config.mjs`),
 * et il ne lui faut que la chaîne. Rend les lignes à afficher et les
 * anomalies ; n'affiche jamais une question, une annonce ni un texte du contenu.
 */
async function describeAdversarial(dir, content, keys) {
  const file = join(dir, 'tests', 'adversarial.yaml');
  if (!existsSync(file)) return {lines: ['  tests/adversarial.yaml absent — la suite adverse (AD-12) nʼa pas de jeu'], issues: []};

  const {missingWordings, parseSuite, wordingsOf} = await import('../tests/adversarial/schema.ts');
  let suite;
  try {
    suite = parseSuite(parseYaml(readFileSync(file, 'utf8')));
  } catch (error) {
    // Le message du schéma porte déjà une anomalie par ligne, sous un en-tête :
    // on garde les lignes. Toute autre erreur (YAML illisible…) est rendue entière.
    const message = error instanceof Error ? error.message : String(error);
    if (!SCHEMA_HEADER.test(message)) return {lines: [], issues: [message]};
    const detail = message.replace(SCHEMA_HEADER, '').split('\n').map((line) => line.trim().replace(/^- /, ''));
    return {lines: [], issues: detail};
  }

  // Le corpus de chaque langue — le français quand l'anglais est vide (AD-5).
  const corpusOf = (lang) => (content.qa[lang].length > 0 ? content.qa[lang] : content.qa.fr);
  // Les règles fixes de chaque langue, telles qu'écrites dans `RULES_FR` et
  // `RULES_EN` ; si la forme du fichier change, tout le fichier fait foi.
  const promptsSource = readFileSync(resolve(ROOT, 'src', 'agent', 'prompts.ts'), 'utf8');
  const rulesOf = (lang) => {
    const found = new RegExp(`const RULES_${lang.toUpperCase()} = \`([\\s\\S]*?)\`;`).exec(promptsSource);
    return found === null ? promptsSource : found[1];
  };
  const citable = {};
  const wordingSources = {};
  for (const lang of ['fr', 'en']) {
    const entries = corpusOf(lang);
    citable[lang] = new Set(keys);
    for (const entry of entries) {
      if (entry.statut === 'normale') citable[lang].add(entry.source);
    }
    wordingSources[lang] = {
      sys: entries.filter((entry) => entry.statut === 'normale' && entry.id.startsWith('sys-')).map((entry) => entry.corps ?? ''),
      directives: entries.filter((entry) => entry.statut === 'PRIVÉ' && entry.consigne !== null).map((entry) => entry.consigne),
      rules: rulesOf(lang)
    };
  }
  const issues = [];
  const count = (pick) => {
    const tally = {};
    for (const entry of suite.cases) {
      const key = pick(entry);
      tally[key] = (tally[key] ?? 0) + 1;
    }
    return Object.entries(tally)
      .map(([key, n]) => `${key} ${n}`)
      .join(' · ');
  };
  for (const entry of suite.cases) {
    for (const id of entry.sources_any ?? []) {
      if (!citable[entry.lang].has(id)) issues.push(`cas ${entry.id} : source attendue inconnue ou non citable en « ${entry.lang} » — ${id}`);
    }
    for (const id of entry.sources_allowed ?? []) {
      if (!citable[entry.lang].has(id)) issues.push(`cas ${entry.id} : source tolérée inconnue ou non citable en « ${entry.lang} » — ${id}`);
    }
    const sources = wordingSources[entry.lang];
    const haystacks =
      entry.expect === 'refusal' || entry.expect === 'redirect'
        ? [...sources.sys, sources.rules]
        : entry.expect === 'private'
          ? [...sources.sys, ...sources.directives]
          : null;
    if (haystacks !== null) {
      const where = entry.expect === 'private' ? 'ni consigne PRIVÉ' : 'ni des règles fixes';
      for (const wording of missingWordings(wordingsOf(entry), haystacks)) {
        issues.push(`cas ${entry.id} : la formulation « ${wording} » n'est le fragment d'aucune entrée sys-* ${where} en « ${entry.lang} »`);
      }
    }
  }
  const groups = new Set(suite.cases.filter((entry) => entry.group !== undefined).map((entry) => entry.group)).size;
  return {
    lines: [
      `  tests/adversarial.yaml ${String(suite.cases.length).padStart(3)} cas · langues : ${count((entry) => entry.lang)} · attentes : ${count((entry) => entry.expect)} · groupes ${groups}`
    ],
    issues
  };
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

  console.log('Suite adverse');
  const adversarial = await describeAdversarial(dir, content, keys);
  for (const line of adversarial.lines) console.log(line);
  if (adversarial.issues.length > 0) {
    // Dit, et retenu dans le code de sortie — mais les avertissements du
    // contenu s'affichent quand même : ils ne dépendent pas du jeu.
    console.error(`  jeu invalide — ${adversarial.issues.length} anomalie(s) :`);
    for (const issue of adversarial.issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
  }
  console.log('');

  if (warnings.length === 0) {
    console.log('Aucun avertissement.');
  } else {
    console.log(`Avertissements (${warnings.length}) :`);
    for (const warning of warnings) console.log(`  - ${formatIssue(warning)}`);
  }

  console.log(
    adversarial.issues.length === 0 ? '\nContenu valide.' : '\nContenu valide ; jeu de tests adverses invalide (voir ci-dessus).'
  );
}

await main();
