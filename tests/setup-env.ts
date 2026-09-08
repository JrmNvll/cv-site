/**
 * Environnement de base des tests unitaires.
 *
 * Aucune valeur réelle : la clé est factice, le contenu pointe vers les fixtures
 * fictives du dépôt et les données vers un répertoire temporaire, supprimé à la
 * fin du fichier de test. Les tests qui éprouvent une configuration incomplète
 * modifient ces variables eux-mêmes.
 */
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll} from 'vitest';

const fixtures = fileURLToPath(new URL('./fixtures/content', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'cv-site-tests-'));

process.env.ANTHROPIC_API_KEY = 'cle-de-test-sans-valeur';
process.env.CONTENT_DIR = fixtures;
process.env.DATA_DIR = dataDir;
process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3000';
process.env.HOSTNAME = '127.0.0.1';
process.env.PORT = '3000';
process.env.ADMIN_DEV = '0';

afterAll(() => {
  rmSync(dataDir, {recursive: true, force: true});
});
