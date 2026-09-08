/**
 * Coquille bilingue — tout ce qui vit sous un préfixe de langue.
 * `<html>` et `<body>` viennent de la racine `src/app/layout.tsx` ;
 * `/admin` vit dans une autre branche, hors `[locale]` (AD-10).
 */
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {getTranslations, setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing} from '@/i18n/routing';

type LocaleParams = {locale: string};

export function generateStaticParams(): LocaleParams[] {
  return routing.locales.map((locale) => ({locale}));
}

export async function generateMetadata({
  params
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const {locale} = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'meta'
  });

  return {
    title: t('title'),
    description: t('description'),
    // AD-11 : la balise est répétée par l'application, en plus de l'en-tête
    // `X-Robots-Tag` posé par Caddy. Redondance voulue.
    robots: {index: false, follow: false}
  };
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<LocaleParams>;
}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
