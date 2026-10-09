/**
 * Le schéma de `usage.db` **avant** la story 12 — la version 4, celle qui est
 * en production au moment où la première migration du projet est écrite.
 *
 * Dérivé du DDL courant, et non recopié : une base d'essai qui divergerait du
 * vrai schéma ne prouverait rien de la migration. Deux fichiers s'en servent —
 * `journal.test.ts` (la migration elle-même) et `migrate-script.test.ts`
 * (`npm run migrate` en sous-processus) —, d'où ce module partagé plutôt que la
 * même découpe à deux endroits.
 */
import {DDL, SESSION_LABEL_CHECK} from '@/journal/schema';

/** Le DDL de la version 4 : `session` sans sa colonne `label` ni son `CHECK`. */
export const DDL_V4 = DDL.replace(
  /,\n(?:\s*--[^\n]*\n)*\s*label\s+TEXT[^\n]*\n\) STRICT;/,
  '\n) STRICT;'
);

/**
 * La découpe a-t-elle bien eu lieu ? Un DDL qui changerait de forme laisserait
 * sinon passer une « base v4 » qui porte déjà la colonne, et les tests de
 * migration ne prouveraient plus rien. Les appelants l'affirment.
 *
 * Le témoin est la contrainte de la colonne, pas le mot `label` : la table
 * `ip_label` en porte une, elle aussi, et de version 4 déjà.
 */
export const DDL_V4_EST_DERIVE = DDL_V4 !== DDL && !DDL_V4.includes(SESSION_LABEL_CHECK);
