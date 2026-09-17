/**
 * Gardes textuels de l'espace d'administration (story 8, AD-10) — ce que la
 * structure des sources doit respecter, relu fichier par fichier :
 *  - aucune Server Action dans `src/app` : toute mutation est un formulaire
 *    vers une route handler ;
 *  - l'admin ne se journalise pas et ne porte pas next-intl : rien sous
 *    `src/app/(admin)` n'importe `@/app/_lib/visit` ni `next-intl` ;
 *  - `@/journal` et `@/content` n'y sont atteints qu'à l'appel, par un
 *    `await import()` — un import statique entraînerait `@/env` au build ;
 *  - l'admin n'a aucun texte dans `messages/` : il est en français, dans ses
 *    composants ;
 *  - deux racines, et rien au-dessus : ni `layout` ni `not-found` à la
 *    racine de `src/app`.
 * Un garde textuel, pas une preuve exhaustive.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

const ROOT = fileURLToPath(new URL('../../src', import.meta.url));
const APP = join(ROOT, 'app');
const ADMIN = join(APP, '(admin)');

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const nom = (path: string) => relative(ROOT, path).split(sep).join('/');

describe('lʼespace dʼadministration', () => {
  const appSources = sources(APP);
  const adminSources = appSources.filter((path) => path.startsWith(ADMIN + sep));

  it('a bien des sources à contrôler', () => {
    expect(adminSources.map(nom).sort()).toEqual([
      'app/(admin)/admin/[...rest]/page.tsx',
      'app/(admin)/admin/_components/admin-nav.tsx',
      'app/(admin)/admin/_components/breadcrumb.tsx',
      'app/(admin)/admin/_components/forms.tsx',
      'app/(admin)/admin/_components/sessions-table.tsx',
      'app/(admin)/admin/_lib/format.ts',
      'app/(admin)/admin/_lib/mutation-route.ts',
      'app/(admin)/admin/api/adresses/[ip]/route.ts',
      'app/(admin)/admin/api/visiteurs/[id]/route.ts',
      'app/(admin)/admin/error.tsx',
      'app/(admin)/admin/layout.tsx',
      'app/(admin)/admin/not-found.tsx',
      'app/(admin)/admin/page.tsx',
      'app/(admin)/admin/questions/page.tsx',
      'app/(admin)/admin/sessions/[id]/page.tsx',
      'app/(admin)/admin/visiteurs/[id]/page.tsx'
    ]);
  });

  it('aucune Server Action dans src/app : `use server` nʼy apparaît nulle part', () => {
    const fautes = appSources.filter((path) => /['"]use server['"]/.test(readFileSync(path, 'utf8')));
    expect(fautes.map(nom)).toEqual([]);
  });

  it('nʼimporte ni @/app/_lib/visit ni next-intl : lʼadmin ne se journalise pas et nʼest pas localisé', () => {
    const fautes = adminSources.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /['"]@\/app\/_lib\/visit['"]|_lib\/visit['"]|['"]next-intl/.test(source) || /recordVisit|getTranslations|getLocale/.test(source);
    });
    expect(fautes.map(nom)).toEqual([]);
  });

  it('nʼa que deux composants client, et pour une raison dite : la navigation (usePathname) et la page dʼerreur (Next lʼimpose)', () => {
    const clients = adminSources.filter((path) => /^\s*['"]use client['"]/m.test(readFileSync(path, 'utf8')));
    expect(clients.map(nom).sort()).toEqual(['app/(admin)/admin/_components/admin-nav.tsx', 'app/(admin)/admin/error.tsx']);
    // Aucun des deux ne touche au journal, à la requête, ni à un formulaire.
    for (const path of clients) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/@\/journal|@\/env|fetch\(|<form/);
    }
  });

  it('a une page dʼerreur en français dans son document : une page qui lève ne tombe pas sur lʼécran générique de Next', () => {
    const erreur = readFileSync(join(ADMIN, 'admin', 'error.tsx'), 'utf8');
    expect(erreur).toMatch(/^\s*'use client';/m);
    expect(erreur).toContain('export default function AdminError');
    expect(erreur).toContain('reset');
    expect(erreur).toContain('Le journal ne répond pas');
    expect(erreur).toContain('href="/admin"');
    // Le message de l'exception n'est pas rendu : il peut porter un chemin ou un verrou.
    expect(erreur).not.toMatch(/\{error\.message\}|error\.digest\}/);
  });

  it('marque la section courante et nomme le fil dʼAriane', () => {
    expect(readFileSync(join(ADMIN, 'admin', '_components', 'admin-nav.tsx'), 'utf8')).toContain("aria-current={href === section ? 'page' : undefined}");
    expect(readFileSync(join(ADMIN, 'admin', '_components', 'breadcrumb.tsx'), 'utf8')).toContain('aria-label="Fil d’Ariane"');
  });

  it('chaque page exporte son titre, que le gabarit de la racine complète', () => {
    expect(readFileSync(join(ADMIN, 'admin', 'layout.tsx'), 'utf8')).toContain("template: '%s — Administration'");
    const titres: Record<string, RegExp> = {
      // Même segment que le layout : le gabarit ne s'y applique pas, le titre est absolu.
      'page.tsx': /metadata: Metadata = \{title: \{absolute: 'Tableau de bord — Administration'\}\}/,
      'questions/page.tsx': /metadata: Metadata = \{title: 'Questions'\}/,
      '[...rest]/page.tsx': /metadata: Metadata = \{title: 'Introuvable'\}/,
      'sessions/[id]/page.tsx': /generateMetadata[\s\S]*Session du \$\{formatInstant/,
      'visiteurs/[id]/page.tsx': /generateMetadata[\s\S]*Visiteur \$\{visitorLabel/
    };
    for (const [fichier, motif] of Object.entries(titres)) {
      expect(readFileSync(join(ADMIN, 'admin', ...fichier.split('/')), 'utf8'), fichier).toMatch(motif);
    }
  });

  it('nʼatteint @/journal et @/content quʼà lʼappel, jamais par un import statique de valeur', () => {
    const fautes = adminSources.filter((path) => {
      const source = readFileSync(path, 'utf8');
      // `import type … from '@/journal'` est effacé à la compilation : il n'entraîne rien.
      const statiques = [...source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"]@\/(journal|content)[^'"]*['"]/gm)];
      return statiques.length > 0;
    });
    expect(fautes.map(nom)).toEqual([]);
  });

  it('chaque page et chaque route qui lit le journal le fait par `await import(\'@/journal\')`, en force-dynamic', () => {
    const lecteurs = adminSources.filter((path) => readFileSync(path, 'utf8').includes("import('@/journal')"));
    expect(lecteurs.map(nom).sort()).toEqual([
      'app/(admin)/admin/api/adresses/[ip]/route.ts',
      'app/(admin)/admin/api/visiteurs/[id]/route.ts',
      'app/(admin)/admin/page.tsx',
      'app/(admin)/admin/questions/page.tsx',
      'app/(admin)/admin/sessions/[id]/page.tsx',
      'app/(admin)/admin/visiteurs/[id]/page.tsx'
    ]);
    for (const path of lecteurs) {
      expect(readFileSync(path, 'utf8'), nom(path)).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  it('ne lit aucun cookie de visite : ni cookies() ni cv_visitor ni cv_session', () => {
    const fautes = adminSources.filter((path) => /cookies\(|cv_visitor|cv_session|visit-cookies/.test(readFileSync(path, 'utf8')));
    expect(fautes.map(nom)).toEqual([]);
  });

  it('nʼa aucun rendu par dangerouslySetInnerHTML : les réponses passent par renderMarkdown', () => {
    const fautes = adminSources.filter((path) => /dangerouslySetInnerHTML\s*[=:]/.test(readFileSync(path, 'utf8')));
    expect(fautes.map(nom)).toEqual([]);
    expect(readFileSync(join(ADMIN, 'admin', 'sessions', '[id]', 'page.tsx'), 'utf8')).toContain('renderMarkdown(');
  });

  it('nʼécrit aucune couleur : les jetons de globals.css seulement, aucun `dark:`', () => {
    const fautes = adminSources.filter((path) => /\bdark:|#[0-9a-f]{3,8}\b|oklch\(|rgb\(/i.test(readFileSync(path, 'utf8')));
    expect(fautes.map(nom)).toEqual([]);
  });

  it('nʼa aucune clé dans messages/ : ses textes vivent dans ses composants', () => {
    for (const catalogue of [fr, en]) {
      expect(Object.keys(catalogue).some((key) => /admin/i.test(key))).toBe(false);
      expect(JSON.stringify(catalogue)).not.toMatch(/"admin/i);
    }
  });

  it('a sa propre racine (lang="fr", noindex, sans recordVisit) et le site la sienne — rien au-dessus', () => {
    const racineAdmin = readFileSync(join(ADMIN, 'admin', 'layout.tsx'), 'utf8');
    expect(racineAdmin).toContain('<html lang="fr">');
    expect(racineAdmin).toMatch(/robots:\s*\{index:\s*false,\s*follow:\s*false\}/);
    expect(racineAdmin).toContain("import '@/app/globals.css'");
    const racineSite = readFileSync(join(APP, '(site)', 'layout.tsx'), 'utf8');
    expect(racineSite).toContain('recordVisit(');
    expect(racineSite).toContain('<html lang={locale}>');
    expect(existsSync(join(APP, 'layout.tsx'))).toBe(false);
    expect(existsSync(join(APP, 'not-found.tsx'))).toBe(false);
    // La 404 de toute URL sans route est la 404 globale — un document
    // complet, journalisé — ; l'admin garde la sienne pour ce qu'il reconnaît.
    expect(existsSync(join(APP, '(site)', 'not-found.tsx'))).toBe(true);
    expect(existsSync(join(APP, '(site)', '[locale]', '[...rest]'))).toBe(false);
    const globale = readFileSync(join(APP, 'global-not-found.tsx'), 'utf8');
    expect(globale).toContain('recordVisit(');
    expect(globale).toContain('<html lang={locale}>');
    expect(globale).toContain("import SiteNotFound from './(site)/not-found'");
    expect(readFileSync(join(ROOT, '..', 'next.config.ts'), 'utf8')).toMatch(/globalNotFound:\s*true/);
    expect(existsSync(join(ADMIN, 'admin', 'not-found.tsx'))).toBe(true);
  });

  it('nʼa que des formulaires HTML : method="post" vers /admin/api/, et un champ from', () => {
    const forms = readFileSync(join(ADMIN, 'admin', '_components', 'forms.tsx'), 'utf8');
    const formulaires = [...forms.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]);
    expect(formulaires).toHaveLength(2);
    for (const form of formulaires) {
      expect(form).toContain('method="post"');
      expect(form).toMatch(/action=\{`\/admin\/api\/(visiteurs|adresses)\//);
      expect(form).not.toContain('onSubmit');
    }
    expect(forms.match(/name="from"/g)).toHaveLength(2);
    expect(forms).not.toContain("'use client'");
  });
});
