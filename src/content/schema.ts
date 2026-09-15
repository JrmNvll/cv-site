/**
 * Schéma de `cv.yaml` — le format écrit à la main dans le dépôt privé, figé côté code
 * (AD-2). Le fichier réel est la **référence** : ce qui n'y figure pas est
 * optionnel, ce qui y figure sous deux formes est accepté sous ses deux formes.
 *
 * Ce module ne décide rien de ce qui *sort* : la liste blanche des projections
 * vit dans `projections.ts` (AD-8). Ici, on ne fait que reconnaître le fichier.
 */
import {z} from 'zod';

/** Les deux langues du site — AD-5. */
export const LANGS = ['fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Champ textuel : une chaîne, ou une paire `{fr, en}`. Le fichier de référence
 * mélange les deux (`experiences[].lieu` est une chaîne pour trois expériences
 * et un objet pour `conge-parental`).
 */
export const localizedText = z.union([
  z.string(),
  z.object({fr: z.string(), en: z.string()})
]);
export type LocalizedText = z.infer<typeof localizedText>;

/** Même règle pour les listes : `[…]` ou `{fr: […], en: […]}`. */
export const localizedList = z.union([
  z.array(z.string()),
  z.object({fr: z.array(z.string()), en: z.array(z.string())})
]);
export type LocalizedList = z.infer<typeof localizedList>;

/**
 * Année ou date. YAML 1.2 rend `2006-07-06` en chaîne mais `2006` en nombre :
 * les deux sont acceptés, la normalisation en chaîne a lieu à la projection.
 */
const dateLike = z.union([z.string().min(1), z.number()]);

/** Date ISO complète **et** réellement au calendrier : `1988-14-02` n'existe pas. */
export function isCalendarDate(value: string): boolean {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parsed) return false;
  const [year, month, day] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Date de naissance. Contrairement aux autres dates, celle-ci est **calculée**
 * (l'âge affiché, AD-8) : une chaîne libre comme « hier » ou un 14ᵉ mois
 * traverserait jusqu'à la page sous forme d'âge faux. Mieux vaut refuser.
 */
const birthDate = z
  .string()
  .refine(isCalendarDate, 'date attendue au format AAAA-MM-JJ, et valide au calendrier');

/**
 * Identifiant stable d'un nœud citable : il devient une clé de citation
 * `cv:experiences.<id>` (AD-4), donc il doit rester lisible, sûr et **écrit
 * dans le fichier**. Rien ne le dérive d'un libellé ni d'une position : renommer
 * une catégorie ou intervertir deux certificats ne doit pas déplacer une
 * citation déjà émise.
 */
const stableId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'identifiant attendu en minuscules séparées par des tirets');

/** Chemin de fichier relatif à `CONTENT_DIR` — jamais projeté (AD-8). */
const relativePath = z.string().min(1);

/**
 * Adresse d'un profil, avec ou sans schéma : le fichier de référence écrit
 * `linkedin.com/in/…`. Le schéma est ajouté à la projection — mais seuls `http`
 * et `https` passent ici, pour qu'aucun `javascript:` ne devienne un lien de la
 * page.
 */
const profileUrl = z
  .string()
  .regex(
    /^(?:https?:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i,
    'adresse attendue sous la forme domaine/chemin, en http(s) ou sans schéma'
  );

/** Ce dont `uniqueIds` a besoin d'un contexte Zod : signaler une anomalie. */
type IssueSink = {
  addIssue: (issue: {code: 'custom'; path: (string | number)[]; message: string}) => void;
};

/**
 * Vérifie qu'une famille de nœuds citables ne porte pas deux fois le même id :
 * deux `cv:experiences.<id>` identiques désigneraient deux nœuds différents, et
 * citation de l'agent cesserait de vouloir dire quelque chose (AD-4).
 */
function uniqueIds(famille: string) {
  return (entries: readonly {id: string}[], ctx: IssueSink): void => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `identifiant « ${entry.id} » déjà utilisé : la clé cv:${famille}.${entry.id} serait ambiguë`
        });
      }
      seen.add(entry.id);
    });
  };
}

export const cvSchema = z.object({
  /** Traçabilité de l'extraction. Ne sort d'aucune projection (AD-8). */
  meta: z
    .object({
      langues_disponibles: z.array(z.string()).optional(),
      derniere_extraction: dateLike.optional(),
      sources: z.array(relativePath).optional()
    })
    .optional(),

  identite: z.object({
    prenom: z.string().min(1),
    nom: z.string().min(1),
    /** Hors liste blanche : ne sort d'aucune projection. */
    prenoms_etat_civil: z.string().optional(),
    date_naissance: birthDate,
    /** Hors liste blanche. */
    lieu_naissance: z.string().optional(),
    nationalite: localizedText.optional(),
    permis: localizedText.nullable().optional(),
    /** Chemin relatif à `CONTENT_DIR` : seule sa présence est projetée. */
    photo: relativePath.optional(),
    titre: localizedText,
    sous_titre: localizedText.optional()
  }),

  contact: z.object({
    /** Jamais dans le HTML ni dans le contexte du modèle (AD-8). */
    telephone: z.string().optional(),
    email: z.email("adresse de courriel attendue"),
    /**
     * Hors liste blanche : donnée de domicile. Le schéma reste large — ce champ
     * ne sort d'aucune projection, une validation stricte n'y protégerait rien
     * et bloquerait le démarrage sur un code postal écrit sans guillemets.
     */
    adresse: z
      .union([z.string(), z.record(z.string(), z.union([z.string(), z.number()]))])
      .optional(),
    /**
     * Ce que le CV **dit** du domicile : la commune et le pays, écrits pour être
     * affichés (« Viry (France) »). Champ distinct de `adresse` par construction :
     * rien n'est dérivé de l'adresse postale, qui ne sort jamais (AD-8).
     */
    localite: localizedText.optional(),
    linkedin: profileUrl.optional()
  }),

  profil: localizedText,

  langues: z.array(z.object({langue: localizedText, niveau: localizedText})),

  competences: z
    .array(z.object({id: stableId, categorie: localizedText, items: localizedList}))
    .superRefine(uniqueIds('competences')),

  atouts: localizedList,

  experiences: z.array(
    z.object({
      id: stableId,
      poste: localizedText,
      entreprise: z.string().nullable().optional(),
      lieu: localizedText.optional(),
      activite: localizedText.optional(),
      debut: dateLike.optional(),
      fin: dateLike.nullable().optional(),
      environnement: localizedList.optional(),
      realisations: localizedList.optional()
    })
  ).superRefine(uniqueIds('experiences')),

  formation: z.array(
    z.object({
      id: stableId,
      diplome: localizedText,
      /** L'option ou la spécialité du diplôme, affichée sous son intitulé. */
      option: localizedText.optional(),
      etablissement: z.string().optional(),
      academie: z.string().optional(),
      annee: dateLike.optional(),
      date_examen: dateLike.optional(),
      equivalence_suisse: localizedText.nullable().optional(),
      /** Chemin relatif à `CONTENT_DIR` : hors liste blanche. */
      justificatif: relativePath.optional(),
      /** `false` retire l'entrée de l'affichage, pas du contexte (AD-8). */
      dans_cv: z.boolean().default(true)
    })
  ).superRefine(uniqueIds('formation')),

  /** Données de tiers : hors des deux projections, sans exception (AD-8). */
  references: z
    .array(
      z.object({
        nom: z.string(),
        fonction: localizedText.optional(),
        telephone: z.string().optional(),
        email: z.string().optional(),
        present_dans: z.array(z.string()).optional()
      })
    )
    .optional(),

  certificats_travail: z
    .array(
      z.object({
        id: stableId,
        entreprise: z.string().min(1),
        date: dateLike.optional(),
        /** Donnée de tiers : hors des deux projections (AD-8). */
        signataire: z.string().optional(),
        periode_attestee: z.string().optional(),
        fonction_attestee: localizedText.optional(),
        points_cles: localizedList.optional(),
        /** Chemin relatif à `CONTENT_DIR` : hors liste blanche. */
        fichier: relativePath.optional()
      })
    )
    .superRefine(uniqueIds('certificats_travail'))
    .optional(),

  lettre_motivation: z
    .object({
      /** Chemin relatif à `CONTENT_DIR` : hors liste blanche. */
      fichier: relativePath.optional(),
      type: z.string().optional(),
      arguments_cles: localizedList
    })
    .optional()
});

export type CvDocument = z.infer<typeof cvSchema>;
export type CvExperience = CvDocument['experiences'][number];
export type CvFormation = CvDocument['formation'][number];
