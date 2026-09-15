/**
 * L'identité et le positionnement — la moitié gauche du premier écran.
 *
 * L'ordre est celui de `CAP-1` : **le positionnement IA d'abord**, le parcours
 * ensuite. Le titre du CV porte ce positionnement (`identite.titre`), il est
 * donc le `h1` ; l'historique WinDev n'apparaît que plus bas, dans la section
 * « Parcours ».
 *
 * Les deux chiffres du bandeau ne sont écrits nulle part : ils se **déduisent**
 * des expériences projetées (`format.ts`). Les recopier depuis la maquette
 * obligerait à les corriger à la main chaque année. La maquette y mettait aussi
 * le permis de travail ; Jérémie l'a jugé trop mis en avant — il vit désormais
 * dans les informations pratiques, en bas de page, avec l'âge et la localité.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {PHOTO_CSS_HEIGHT, PHOTO_CSS_WIDTH, photoSrcSet} from '@/app/api/photo/sizes';
import {careerYears, employerCount, joinParts} from './format';

export type IdentityBlockProps = {
  readonly identite: DisplayProjection['identite'];
  readonly profil: string;
  readonly experiences: DisplayProjection['experiences'];
};

type Figure = {readonly value: string; readonly label: string};

export async function IdentityBlock({identite, profil, experiences}: IdentityBlockProps) {
  const t = await getTranslations('identity');
  const name = joinParts([identite.prenom, identite.nom], ' ') ?? '';

  const years = careerYears(experiences, new Date());
  const employers = employerCount(experiences);
  // Le libellé s'accorde au nombre (« 1 an », « 20 ans ») : pluriel ICU.
  const figures: Figure[] = [
    ...(years === undefined ? [] : [{value: String(years), label: t('years', {count: years})}]),
    ...(employers === undefined
      ? []
      : [{value: String(employers), label: t('companies', {count: employers})}])
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start gap-6">
        {identite.photo ? (
          // `next/image` n'apporterait rien ici : la photo vient d'une route qui
          // lit CONTENT_DIR et la sert déjà découpée au cadre, à chaque densité
          // (`srcset`). Le VPS n'a pas à faire tourner un optimiseur générique
          // pour une seule image. Le cadre CSS est celui de `sizes.ts`, en style
          // plutôt qu'en classe : une seule source pour les deux.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/api/photo"
            srcSet={photoSrcSet()}
            alt={t('photoAlt', {name})}
            width={PHOTO_CSS_WIDTH}
            height={PHOTO_CSS_HEIGHT}
            style={{width: PHOTO_CSS_WIDTH, height: PHOTO_CSS_HEIGHT}}
            className="shrink-0 rounded-[3px] object-cover"
          />
        ) : null}
        {/* `xl:flex-1` : la photo passe à gauche du titre, comme la maquette,
            seulement quand la colonne est assez large pour les deux. En deçà,
            `flex-wrap` la remet au-dessus plutôt que d'écraser le titre.
            `break-words` est le dernier recours si un mot ne tient toujours pas. */}
        <div className="min-w-0 xl:flex-1">
          <h1 className="font-serif text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-normal tracking-[-0.01em] break-words text-balance">
            {identite.titre}
          </h1>
          {identite.sous_titre === undefined ? null : (
            <p className="mt-2.5 text-[17px] text-ink-soft">{identite.sous_titre}</p>
          )}
        </div>
      </div>

      {profil === '' ? null : (
        <p className="mt-7 max-w-[34em] text-[19px] leading-[1.55]">{profil}</p>
      )}

      {figures.length === 0 ? null : (
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-t border-rule pt-6">
          {figures.map((figure) => (
            // `flex-col-reverse` : le terme reste avant sa définition dans le
            // document — un lecteur d'écran annonce « ans d'expérience : 20 » —
            // mais la maquette veut le chiffre au-dessus de son libellé.
            <div key={figure.label} className="flex flex-col-reverse">
              <dt className="mt-1 text-[13px] text-ink-muted">{figure.label}</dt>
              <dd className="font-serif text-[clamp(1.75rem,3vw,2.125rem)] leading-none">
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
