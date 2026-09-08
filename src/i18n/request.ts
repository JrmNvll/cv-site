/**
 * Configuration de la requête pour next-intl — AD-5 : une langue, un corpus,
 * une projection, une réponse. La locale résolue ici gouverne l'interface ;
 * elle gouvernera aussi le corpus indexé à partir de la story « contenu ».
 */
import {hasLocale} from 'next-intl';
import {getRequestConfig} from 'next-intl/server';
import {routing} from './routing';

export default getRequestConfig(async ({requestLocale}) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});
