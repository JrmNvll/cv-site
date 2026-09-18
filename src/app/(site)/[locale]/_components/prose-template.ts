/**
 * Les gabarits des textes de prose (story 9) — deux marques, et rien d'autre.
 *
 * Les fichiers Markdown du dépôt public ne portent aucune donnée personnelle
 * (AD-2) : le nom de la personne y est `{name}`, rempli à la requête depuis la
 * projection d'affichage — la même source que la barre. L'hébergeur y est
 * `{hebergeur}`, rempli depuis une constante de la page des mentions
 * (`HOSTING_PROVIDER`) ; tant qu'elle est vide, la phrase se passe du nom :
 * la marque part avec les mots qui l'introduisent, « loué chez » / « rented
 * from », pour que « un serveur privé virtuel loué chez {hebergeur}, sous
 * Windows Server » devienne « un serveur privé virtuel, sous Windows Server ».
 *
 * Aucune autre marque : ce module ne connaît pas le Markdown, il remplace des
 * chaînes. Les valeurs viennent du contenu validé ou du code, jamais d'une
 * requête.
 */

export type ProseValues = {
  /** Le nom de la personne — prénom et nom, depuis la projection. */
  readonly name: string;
  /** Le nom de l'hébergeur ; vide tant qu'il n'est pas donné. */
  readonly hebergeur: string;
};

/** Ce qui introduit l'hébergeur dans les textes, par langue — part avec lui s'il manque. */
export const HOSTING_INTRO: readonly string[] = ['loué chez', 'rented from'];

export function fillTemplate(body: string, values: ProseValues): string {
  let text = body.replaceAll('{name}', values.name);
  if (values.hebergeur === '') {
    for (const intro of HOSTING_INTRO) text = text.replaceAll(` ${intro} {hebergeur}`, '');
    // Une marque orpheline — sans mots d'introduction — part aussi.
    text = text.replaceAll('{hebergeur}', '');
  } else {
    text = text.replaceAll('{hebergeur}', values.hebergeur);
  }
  return text;
}
