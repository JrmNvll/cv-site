/**
 * La bascule de langue (story 9, report de la story 4 clos) : une ancre
 * ordinaire vers la même page dans l'autre langue — `/en` à la racine,
 * `/en/comment` ailleurs, jamais `/en/` ni un `Link` de navigation douce.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {localeHref} from '@/app/(site)/[locale]/_components/language-switch';

describe('localeHref', () => {
  it('rattache la langue cible au chemin courant, sans préfixe de langue', () => {
    expect(localeHref('en', '/')).toBe('/en');
    expect(localeHref('fr', '/')).toBe('/fr');
    expect(localeHref('en', '/comment')).toBe('/en/comment');
    expect(localeHref('fr', '/mentions')).toBe('/fr/mentions');
  });
});

describe('le sélecteur', () => {
  it('rend des ancres ordinaires : la navigation est complète, la visite journalisée (AD-14)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/app/(site)/[locale]/_components/language-switch.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).toContain('<a\n');
    expect(source).toContain('href={localeHref(locale, pathname)}');
    expect(source).not.toMatch(/<Link\b/);
    expect(source).not.toMatch(/import \{[^}]*\bLink\b[^}]*\} from/);
    // `usePathname` reste : c'est lui qui donne le chemin sans préfixe.
    expect(source).toContain("import {usePathname} from '@/i18n/navigation'");
  });
});
