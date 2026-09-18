/**
 * La suite adverse contre l'API **réelle** — AD-12, story 10. `npm run
 * test:adversarial`, jamais dans `verify`, jamais sans l'accord de Jérémie
 * pour l'exécution en cours : chaque cas est un appel facturé.
 *
 * Ce que ce fichier fait : relever `ADVERSARIAL_CONFIRM` telle que le shell
 * l'a posée, compléter l'environnement depuis `.env.local` pour ce qui manque
 * — la clé y reste une variable, elle n'est ni lue ni affichée ici —, refuser
 * de démarrer si `ANTHROPIC_BASE_URL` est posée, si le jeu manque, ou si le
 * consentement du jour n'est pas là (ou vient du fichier), puis jouer
 * `CONTENT_DIR/tests/adversarial.yaml` par le runner, dans
 * `DATA_DIR/adversarial/<horodatage>/`. Le verdict de Vitest est celui de la
 * suite : un échec, un arrêt au budget ou au plafond, une exécution partielle,
 * et la commande sort en 1.
 *
 * Variables : `ADVERSARIAL_CONFIRM=<AAAA-MM-JJ du jour>`, posée par le shell,
 * pour cette exécution ; `ADVERSARIAL_BUDGET_MICRO_USD` (défaut 2 USD) borne
 * la dépense ; `ADVERSARIAL_ONLY=id1,id2` ne rejoue que ces cas, avec leurs
 * groupes entiers — l'exécution est alors partielle et ne vaut pas pour AD-12.
 */
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {budgetFromEnv, consentRefusal, onlyFromEnv, realRunRefusal, runSuite, SUITE_FILE, todayStamp} from './runner';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Le consentement se lit **avant** `.env.local` : une valeur venue du fichier
// vaudrait pour toujours, ce n'est pas un consentement.
const confirmFromShell = process.env.ADVERSARIAL_CONFIRM;

// `.env.local` ne complète que ce que l'environnement ne donne pas déjà :
// une variable posée dans le shell prime, comme pour `node --env-file`.
const envFile = resolve(ROOT, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Requise par `src/env.ts`, sans rôle ici : aucune page n'est servie.
if (!process.env.NEXT_PUBLIC_SITE_URL) process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3000';

describe("la suite adverse contre l'API réelle", () => {
  it('chaque cas reçoit un verdict, le rapport est écrit hors des dépôts, la dépense reste sous le budget', async () => {
    const refusal =
      realRunRefusal(process.env, existsSync) ??
      consentRefusal({before: confirmFromShell, after: process.env.ADVERSARIAL_CONFIRM, today: todayStamp()});
    if (refusal !== null) throw new Error(refusal);

    const result = await runSuite({
      file: join(process.env.CONTENT_DIR!, SUITE_FILE),
      dataDir: process.env.DATA_DIR!,
      budgetMicroUsd: budgetFromEnv(process.env),
      only: onlyFromEnv(process.env)
    });

    expect(result.totalMicroUsd, 'la dépense doit rester sous le budget').toBeLessThanOrEqual(result.budgetMicroUsd);
    expect(result.stopped, 'la suite doit aller au bout').toBeNull();
    expect(
      result.failures.map((failure) => `${failure.id} : ${failure.reasons.join(' ; ')}`),
      `des cas ont échoué — lire ${result.reportMarkdown}`
    ).toEqual([]);
    expect(result.partial, "une exécution partielle (ADVERSARIAL_ONLY) ne vaut pas pour la porte d'AD-12").toBe(false);
  });
});
