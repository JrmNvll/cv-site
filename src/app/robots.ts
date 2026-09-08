import type {MetadataRoute} from 'next';

/**
 * AD-11 — le site n'est pas découvrable. Caddy pose `X-Robots-Tag` sur toutes
 * les réponses, les pages répètent la balise `<meta name="robots">`, et ce
 * `robots.txt` interdit tout : trois couches redondantes, voulues.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{userAgent: '*', disallow: '/'}]
  };
}
