/**
 * Les deux projections de `cv.yaml` — AD-8.
 *
 * **Liste blanche, et rien d'autre.** Chaque champ qui sort est écrit ici, une
 * fois, à la main. Il n'existe aucune liste noire : un champ ajouté demain à
 * `cv.yaml` ne sortira pas tant que personne ne l'aura ajouté ci-dessous. C'est
 * la seule construction qui rende la fuite impossible plutôt qu'improbable.
 *
 * Deux structures distinctes plutôt qu'une vue filtrée à l'usage : `app` ne
 * reçoit jamais l'objet que `agent` reçoit, et réciproquement. Un filtre appliqué
 * au rendu se contourne par le prochain développeur qui remonte à la source.
 *
 * Chaque nœud de la projection `agent` porte sa clé de citation `cv:<chemin>`
 * (AD-4). Les clés sont dérivées du **français** dans les deux langues : une
 * citation doit désigner le même nœud quelle que soit la page.
 */
import {isCalendarDate} from './schema';
import type {CvDocument, Lang, LocalizedList, LocalizedText} from './schema';

/** Nœud citable de la projection `agent` — AD-4. */
type Cited<T> = T & {readonly source: string};

export type ProjectedLangue = {readonly langue: string; readonly niveau: string};

export type ProjectedCompetence = {
  readonly id: string;
  readonly categorie: string;
  readonly items: readonly string[];
};

export type ProjectedExperience = {
  readonly id: string;
  readonly poste: string;
  readonly entreprise?: string;
  readonly lieu?: string;
  readonly activite?: string;
  readonly debut?: string;
  readonly fin?: string;
  readonly environnement?: readonly string[];
  readonly realisations?: readonly string[];
};

export type ProjectedFormation = {
  readonly id: string;
  readonly diplome: string;
  readonly option?: string;
  readonly etablissement?: string;
  readonly academie?: string;
  readonly annee?: string;
  readonly date_examen?: string;
  readonly equivalence_suisse?: string;
};

export type ProjectedCertificat = {
  readonly id: string;
  readonly entreprise: string;
  readonly date?: string;
  readonly periode_attestee?: string;
  readonly fonction_attestee?: string;
  readonly points_cles?: readonly string[];
};

type Identite = {
  readonly prenom: string;
  readonly nom: string;
  readonly titre: string;
  readonly sous_titre?: string;
  readonly nationalite?: string;
  readonly permis?: string;
  readonly date_naissance: string;
  readonly age?: number;
};

type Contact = {readonly email: string; readonly localite?: string; readonly linkedin?: string};

/**
 * Une référence, telle que la page la montre : un nom, une fonction, et la
 * **présence** de coordonnées — jamais les coordonnées elles-mêmes, qui
 * restent dans `restricted` et ne sortent que par une route (AD-8).
 */
export type ProjectedReference = {
  readonly id: string;
  readonly nom: string;
  readonly fonction?: string;
  readonly contact: boolean;
};

/** Ce que la page reçoit. Ni téléphone, ni adresse, ni chemin de fichier. */
export type DisplayProjection = {
  readonly identite: Identite & {readonly photo: boolean};
  readonly contact: Contact;
  readonly profil: string;
  readonly langues: readonly ProjectedLangue[];
  readonly competences: readonly ProjectedCompetence[];
  readonly atouts: readonly string[];
  readonly experiences: readonly ProjectedExperience[];
  /** `formation[dans_cv=false]` est absente de l'affichage — AD-8. */
  readonly formation: readonly ProjectedFormation[];
  /** Nom et fonction seulement ; `present_dans` filtre par langue — AD-8. */
  readonly references: readonly ProjectedReference[];
};

/** Ce que le modèle reçoit. Ni photo, ni référence de tiers, ni chemin. */
export type AgentProjection = {
  readonly identite: Cited<Identite>;
  readonly contact: Cited<Contact>;
  readonly profil: Cited<{readonly texte: string}>;
  readonly langues: Cited<{readonly items: readonly ProjectedLangue[]}>;
  readonly competences: readonly Cited<ProjectedCompetence>[];
  readonly atouts: Cited<{readonly items: readonly string[]}>;
  readonly experiences: readonly Cited<ProjectedExperience>[];
  /** Toute la formation, `dans_cv` compris ou non — AD-8. */
  readonly formation: readonly Cited<ProjectedFormation>[];
  readonly certificats_travail: readonly Cited<ProjectedCertificat>[];
  readonly lettre_motivation: Cited<{readonly arguments_cles: readonly string[]}> | null;
};

export type Projections = {readonly display: DisplayProjection; readonly agent: AgentProjection};

/**
 * Résout un champ textuel dans la langue demandée ; repli sur le français.
 *
 * Rend toujours `string | undefined` : une surcharge promettant `string` pour un
 * argument non nul mentirait, puisqu'une chaîne vide ou une paire vide n'a rien
 * à rendre. Aux appelants de choisir leur repli — et de le choisir visiblement.
 */
export function resolveText(value: LocalizedText | null | undefined, lang: Lang): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  const wanted = value[lang];
  return wanted !== undefined && wanted !== '' ? wanted : value.fr || undefined;
}

/** Même règle pour les listes ; une liste vide reste une liste vide. */
export function resolveList(
  value: LocalizedList | null | undefined,
  lang: Lang
): readonly string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return value[lang] ?? value.fr;
}

/**
 * Un repli de langue a-t-il eu lieu ? Vrai quand le champ est bilingue et que
 * la langue demandée n'y est pas — le lecteur recevra donc l'autre langue.
 */
function fellBack(value: LocalizedText | LocalizedList | null | undefined, lang: Lang): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' || Array.isArray(value)) return false;
  const wanted = (value as Record<Lang, string | string[]>)[lang];
  return wanted === undefined || wanted === '';
}

/** YAML rend `2006` en nombre et `2006-07-06` en chaîne : une seule forme sort. */
function asText(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text === '' ? undefined : text;
}

/**
 * Âge révolu, comme le CV PDF l'affiche (AD-8). Calculé au chargement : le
 * contenu est gelé au démarrage, l'âge se rafraîchit donc au redémarrage du
 * service — un décalage d'un jour, une fois par an, sans conséquence.
 */
export function ageFrom(dateNaissance: string, now: Date): number | undefined {
  // Le schéma garantit déjà une date au calendrier ; ce garde-fou vaut pour les
  // appels directs. Pas d'âge du tout vaut mieux qu'un âge faux.
  if (!isCalendarDate(dateNaissance)) return undefined;
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateNaissance)!;
  const [year, month, day] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : undefined;
}

/**
 * Normalise une adresse de profil en URL absolue. Le fichier de référence écrit
 * `linkedin.com/in/…` : servi tel quel dans un `href`, le navigateur en ferait un
 * lien **relatif** vers une page du site. Le schéma a déjà écarté tout ce qui
 * n'est ni `http` ni `https`, donc rien d'exécutable ne passe ici.
 */
export function absoluteUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Écarte les clés sans valeur : une projection ne porte jamais `undefined`. */
/** Une chaîne qui dit quelque chose : ni absente, ni faite d'espaces. */
function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) kept[key] = item;
  }
  return kept as T;
}

export type ProjectionOptions = {
  /** `identite.photo` désigne-t-il un fichier réellement présent ? */
  readonly hasPhoto: boolean;
  /** Injecté par les tests : l'âge ne doit pas dépendre du jour d'exécution. */
  readonly now?: Date;
};

export type BuildResult = Projections & {
  /**
   * Champs bilingues dont la langue demandée manquait : le lecteur reçoit
   * l'autre langue. Toléré — mais jamais silencieux, comme pour les corpus Q/R
   * (AD-5). `load.ts` en fait des avertissements.
   */
  readonly fallbacks: readonly string[];
};

/**
 * Construit les deux projections dans une langue. Aucun champ n'est copié en
 * bloc : chaque valeur ci-dessous est nommée, une par une.
 */
export function buildProjections(
  cv: CvDocument,
  lang: Lang,
  options: ProjectionOptions
): BuildResult {
  const now = options.now ?? new Date();
  const fallbacks: string[] = [];

  /** Résout un texte et retient le chemin du champ si un repli a eu lieu. */
  function text(value: Parameters<typeof resolveText>[0], path: string): string | undefined {
    if (fellBack(value, lang)) fallbacks.push(path);
    return resolveText(value, lang);
  }

  /** Même chose pour une liste. */
  function list(value: Parameters<typeof resolveList>[0], path: string): readonly string[] | undefined {
    if (fellBack(value, lang)) fallbacks.push(path);
    return resolveList(value, lang);
  }

  const dateNaissance = asText(cv.identite.date_naissance) ?? '';
  const identite: Identite = compact({
    prenom: cv.identite.prenom,
    nom: cv.identite.nom,
    // Repli explicite : `titre` est requis par le type, une clé absente ferait
    // mentir la projection. Le schéma garantit la présence, pas le contenu.
    titre: text(cv.identite.titre, 'identite.titre') ?? `${cv.identite.prenom} ${cv.identite.nom}`,
    sous_titre: text(cv.identite.sous_titre, 'identite.sous_titre'),
    nationalite: text(cv.identite.nationalite, 'identite.nationalite'),
    permis: text(cv.identite.permis, 'identite.permis'),
    date_naissance: dateNaissance,
    age: ageFrom(dateNaissance, now)
  } as Identite);

  const contact: Contact = compact({
    email: cv.contact.email,
    // La localité, jamais l'adresse : `contact.adresse` n'est pas lue ici.
    localite: text(cv.contact.localite, 'contact.localite'),
    linkedin: absoluteUrl(cv.contact.linkedin)
  } as Contact);

  const profil = text(cv.profil, 'profil') ?? '';

  const langues: ProjectedLangue[] = cv.langues.map((entry, index) => ({
    langue: text(entry.langue, `langues[${index}].langue`) ?? '',
    niveau: text(entry.niveau, `langues[${index}].niveau`) ?? ''
  }));

  const competences: ProjectedCompetence[] = cv.competences.map((entry) => ({
    id: entry.id,
    categorie: text(entry.categorie, `competences.${entry.id}.categorie`) ?? entry.id,
    items: list(entry.items, `competences.${entry.id}.items`) ?? []
  }));

  const atouts = list(cv.atouts, 'atouts') ?? [];

  const experiences: ProjectedExperience[] = cv.experiences.map((entry) =>
    compact({
      id: entry.id,
      poste: text(entry.poste, `experiences.${entry.id}.poste`) ?? '',
      entreprise: entry.entreprise ?? undefined,
      lieu: text(entry.lieu, `experiences.${entry.id}.lieu`),
      activite: text(entry.activite, `experiences.${entry.id}.activite`),
      debut: asText(entry.debut),
      fin: asText(entry.fin),
      environnement: list(entry.environnement, `experiences.${entry.id}.environnement`),
      realisations: list(entry.realisations, `experiences.${entry.id}.realisations`)
    } as ProjectedExperience)
  );

  const formation = cv.formation.map((entry) => ({
    dans_cv: entry.dans_cv,
    projected: compact({
      id: entry.id,
      diplome: text(entry.diplome, `formation.${entry.id}.diplome`) ?? '',
      option: text(entry.option, `formation.${entry.id}.option`),
      etablissement: entry.etablissement,
      academie: entry.academie,
      annee: asText(entry.annee),
      date_examen: asText(entry.date_examen),
      equivalence_suisse: text(entry.equivalence_suisse, `formation.${entry.id}.equivalence_suisse`)
    } as ProjectedFormation)
  }));

  const certificats: ProjectedCertificat[] = (cv.certificats_travail ?? []).map((entry) =>
    compact({
      id: entry.id,
      entreprise: entry.entreprise,
      date: asText(entry.date),
      periode_attestee: entry.periode_attestee,
      fonction_attestee: text(
        entry.fonction_attestee,
        `certificats_travail.${entry.id}.fonction_attestee`
      ),
      points_cles: list(entry.points_cles, `certificats_travail.${entry.id}.points_cles`)
    } as ProjectedCertificat)
  );

  const argumentsCles = list(cv.lettre_motivation?.arguments_cles, 'lettre_motivation.arguments_cles');

  const references: ProjectedReference[] = (cv.references ?? [])
    .filter((entry) => entry.present_dans === undefined || entry.present_dans.includes(lang))
    .map((entry) =>
      compact({
        id: entry.id,
        nom: entry.nom,
        fonction: text(entry.fonction, `references.${entry.id}.fonction`),
        // La présence seulement : les valeurs ne quittent pas `restricted`.
        contact: hasText(entry.telephone) || hasText(entry.email)
      } as ProjectedReference)
    );

  const display: DisplayProjection = {
    identite: {...identite, photo: options.hasPhoto},
    contact,
    profil,
    langues,
    competences,
    atouts,
    experiences,
    formation: formation.filter((entry) => entry.dans_cv).map((entry) => entry.projected),
    references
  };

  const agent: AgentProjection = {
    identite: {...identite, source: 'cv:identite'},
    contact: {...contact, source: 'cv:contact'},
    profil: {texte: profil, source: 'cv:profil'},
    langues: {items: langues, source: 'cv:langues'},
    competences: competences.map((entry) => ({...entry, source: `cv:competences.${entry.id}`})),
    atouts: {items: atouts, source: 'cv:atouts'},
    experiences: experiences.map((entry) => ({...entry, source: `cv:experiences.${entry.id}`})),
    formation: formation.map((entry) => ({
      ...entry.projected,
      source: `cv:formation.${entry.projected.id}`
    })),
    certificats_travail: certificats.map((entry) => ({
      ...entry,
      source: `cv:certificats_travail.${entry.id}`
    })),
    lettre_motivation:
      argumentsCles === undefined
        ? null
        : {arguments_cles: argumentsCles, source: 'cv:lettre_motivation'}
  };

  return {display, agent, fallbacks};
}
