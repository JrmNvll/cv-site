/**
 * Mise en forme de ce que la projection `display` contient — et **rien d'autre**.
 *
 * Ces fonctions ne connaissent aucun texte de CV : elles reçoivent des valeurs
 * déjà projetées et décident seulement comment les assembler. Deux choses les
 * justifient plutôt qu'un peu de JSX en ligne :
 *
 *  - la projection est **parsemée de champs optionnels** (`activite`, `lieu`,
 *    `entreprise`, `fin`…) ; assembler « entreprise · lieu » dans le composant,
 *    c'est écrire tôt ou tard « Société · » avec un séparateur orphelin ;
 *  - ce sont les seuls calculs de la page, donc les seuls endroits où une
 *    erreur d'affichage peut se produire sans être vue. Isolés ici, ils sont
 *    testables sans rendre la page.
 */

/**
 * Assemble les parties présentes, et rien de plus.
 *
 * Une valeur absente ou vide disparaît **avec** son séparateur : c'est tout
 * l'intérêt. Rend `undefined` — pas une chaîne vide — quand il ne reste rien,
 * pour que l'appelant puisse retirer l'élément entier plutôt que rendre une
 * ligne vide qui occupe quand même sa hauteur.
 */
export function joinParts(
  parts: readonly (string | undefined | null)[],
  separator = ' · '
): string | undefined {
  const kept = parts
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return kept.length === 0 ? undefined : kept.join(separator);
}

/**
 * L'année d'une date de la projection.
 *
 * `debut` et `fin` arrivent sous les formes que YAML produit : `2006`,
 * `2024-06`, `2006-07-06`. Le CV n'affiche que l'année. Une valeur qui ne
 * commence pas par quatre chiffres est rendue **telle quelle** : mieux vaut
 * afficher ce que le contenu dit que d'en tronquer les quatre premiers
 * caractères et écrire « janv » pour « janvier 2022 ».
 */
export function yearOf(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const trimmed = value.trim();
  return /^\d{4}/.test(trimmed) ? trimmed.slice(0, 4) : trimmed;
}

/**
 * Le mois et l'année d'une date de la projection, dans la langue de la page :
 * « juin 2023 », « June 2023 ». Une valeur qui n'est pas une date ISO est
 * rendue telle quelle — comme `yearOf`, mieux vaut montrer ce que le contenu
 * dit que de le déformer. Formatée en UTC : la date d'un certificat est un
 * jour, pas un instant, et ne doit pas glisser d'un mois selon le fuseau.
 */
export function monthYearLabel(value: string | undefined, locale: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const trimmed = value.trim();
  const parsed = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(trimmed);
  if (!parsed) return trimmed;
  const date = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3] ?? '1')));
  if (Number.isNaN(date.getTime())) return trimmed;
  return new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(
    date
  );
}

/**
 * La période d'une expérience : « 2018 — 2023 », « 2024 — aujourd'hui »,
 * « 2021 » si elle tient dans une seule année.
 *
 * `present` est le libellé d'interface de la langue courante : cette fonction
 * ne le connaît pas, elle le reçoit.
 */
export function periodLabel(
  debut: string | undefined,
  fin: string | undefined,
  present: string
): string | undefined {
  const from = yearOf(debut);
  const to = yearOf(fin);
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined) return to;
  if (to === undefined) return `${from} — ${present}`;
  return from === to ? from : `${from} — ${to}`;
}

/** Ce que les compteurs du premier écran ont besoin de savoir d'une expérience. */
export type CountableExperience = {
  readonly entreprise?: string;
  readonly debut?: string;
  readonly fin?: string;
};

/**
 * Nombre d'années couvertes par le parcours : de la première date de début à
 * la dernière date de fin, ou à l'année courante si une expérience est encore
 * en cours.
 *
 * Calculé, jamais écrit : « 20 ans » dans la maquette est le résultat de ce
 * calcul sur le contenu réel, pas une valeur à recopier — sinon il faudrait
 * penser à l'incrémenter chaque année.
 */
export function careerYears(
  experiences: readonly CountableExperience[],
  now: Date
): number | undefined {
  const starts: number[] = [];
  const ends: number[] = [];
  let ongoing = false;

  for (const experience of experiences) {
    const from = Number(yearOf(experience.debut));
    if (Number.isFinite(from)) starts.push(from);
    const to = Number(yearOf(experience.fin));
    if (Number.isFinite(to)) ends.push(to);
    // Une expérience commencée dont la fin n'est **pas écrite** court toujours.
    // Une fin écrite mais illisible (« janvier 2022 ») n'est pas une absence :
    // elle est ignorée, elle ne prolonge pas le parcours jusqu'à aujourd'hui.
    else if (experience.fin === undefined && Number.isFinite(from)) ongoing = true;
  }

  if (starts.length === 0) return undefined;
  const first = Math.min(...starts);
  // En cours : jusqu'à aujourd'hui, ou jusqu'à une fin déjà écrite plus loin.
  // Rien en cours et aucune fin lisible : pas de chiffre plutôt qu'un faux.
  if (!ongoing && ends.length === 0) return undefined;
  const last = ongoing ? Math.max(now.getFullYear(), ...ends) : Math.max(...ends);
  const span = last - first;
  return span > 0 ? span : undefined;
}

/**
 * Nombre d'employeurs distincts. `entreprise` est absente d'une interruption
 * d'activité (`entreprise: null` dans `cv.yaml`) : ces périodes comptent dans
 * la durée du parcours, pas dans le nombre d'entreprises.
 */
export function employerCount(experiences: readonly CountableExperience[]): number | undefined {
  const employers = new Set(
    experiences
      .map((experience) => experience.entreprise?.trim())
      .filter((name): name is string => typeof name === 'string' && name !== '')
  );
  return employers.size > 0 ? employers.size : undefined;
}
