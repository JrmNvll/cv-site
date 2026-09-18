'use client';

/**
 * Sélecteur de langue — il reste **sur la page courante**.
 *
 * `usePathname` de next-intl rend le chemin *sans* le préfixe de langue ; le
 * lien y rattache la langue cible. Sans lui, `href="/"` ramenait le visiteur
 * à l'accueil à chaque changement de langue — sans conséquence tant qu'il n'y
 * avait qu'une page, mais faux dès la deuxième (constat reporté de la story 1,
 * prouvé depuis `/fr/comment` par `tests/e2e/pages.spec.ts`, story 9).
 *
 * Une ancre ordinaire, pas un `Link` (story 9, report de la story 4 clos) :
 * une navigation douce ne rejouait pas la racine du site — `<html lang>`
 * gardait la langue d'origine sous un texte dans l'autre, et la visite n'était
 * pas journalisée (AD-14). Un chargement complet règle les deux, et le proxy
 * reconduit les cookies.
 *
 * Composant client pour `usePathname` seul : il ne reçoit aucun texte de CV,
 * seulement les libellés d'interface que le serveur lui passe.
 */
import {usePathname} from '@/i18n/navigation';
import type {Locale} from '@/i18n/routing';

export type LanguageSwitchProps = {
  readonly current: Locale;
  readonly locales: readonly Locale[];
  /** Libellé du groupe, pour un lecteur d'écran. */
  readonly label: string;
  /**
   * Nom de chaque langue dans sa propre langue. Affiché en abrégé — « FR »,
   * « EN », comme la maquette — mais porté en entier par `aria-label` : « FR »
   * annoncé par un lecteur d'écran ne veut rien dire.
   */
  readonly names: Readonly<Record<string, string>>;
};

/** `/en` à la racine, `/en/comment` ailleurs : jamais `/en/`. */
export function localeHref(target: Locale, pathname: string): string {
  return `/${target}${pathname === '/' ? '' : pathname}`;
}

export function LanguageSwitch({current, locales, label, names}: LanguageSwitchProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="flex shrink-0 overflow-hidden rounded-[4px] border border-rule-strong"
    >
      {locales.map((locale) => {
        const active = locale === current;
        return (
          <a
            key={locale}
            href={localeHref(locale, pathname)}
            aria-current={active ? 'page' : undefined}
            aria-label={names[locale]}
            lang={locale}
            className={
              active
                ? 'bg-ink px-3 py-1 text-[13px] font-medium text-surface no-underline'
                : 'px-3 py-1 text-[13px] text-ink-muted no-underline hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:underline'
            }
          >
            {locale.toUpperCase()}
          </a>
        );
      })}
    </nav>
  );
}
