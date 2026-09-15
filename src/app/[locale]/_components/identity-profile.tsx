/**
 * Le profil et les deux chiffres — sous le titre, à gauche de l'assistant.
 *
 * Les deux chiffres du bandeau ne sont écrits nulle part : ils se **déduisent**
 * des expériences projetées (`format.ts`). Les recopier depuis la maquette
 * obligerait à les corriger à la main chaque année. La maquette y mettait aussi
 * le permis de travail ; Jérémie l'a jugé trop mis en avant — il vit désormais
 * dans les informations pratiques, en bas de page, avec l'âge et la localité.
 */
import {getTranslations} from 'next-intl/server';
import type {DisplayProjection} from '@/content';
import {careerYears, employerCount} from './format';

export type IdentityProfileProps = {
  readonly profil: string;
  readonly experiences: DisplayProjection['experiences'];
};

type Figure = {readonly value: string; readonly label: string};

export async function IdentityProfile({profil, experiences}: IdentityProfileProps) {
  const t = await getTranslations('identity');

  const years = careerYears(experiences, new Date());
  const employers = employerCount(experiences);
  // Le libellé s'accorde au nombre (« 1 an », « 20 ans ») : pluriel ICU.
  const figures: Figure[] = [
    ...(years === undefined ? [] : [{value: String(years), label: t('years', {count: years})}]),
    ...(employers === undefined
      ? []
      : [{value: String(employers), label: t('companies', {count: employers})}])
  ];

  if (profil === '' && figures.length === 0) return null;

  return (
    <div>
      {profil === '' ? null : <p className="max-w-[34em] text-[19px] leading-[1.55]">{profil}</p>}

      {figures.length === 0 ? null : (
        <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-5 border-t border-rule pt-6">
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
