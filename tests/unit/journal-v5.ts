/**
 * Le schéma de `usage.db` **avant** la story 13 — la version 5, celle qui est
 * en production (v1.4.0) au moment où le blocage d'un visiteur est écrit.
 *
 * Dérivé du DDL courant, comme `./journal-v4.ts` et pour la même raison : une
 * base d'essai recopiée à la main divergerait un jour du vrai schéma, et le
 * test de migration ne prouverait plus rien.
 */
import {BLOCK_DDL, DDL} from '@/journal/schema';

/** Le DDL de la version 5 : tout, sauf la table des blocages et son index. */
export const DDL_V5 = DDL.replace(BLOCK_DDL, '');

/**
 * La découpe a-t-elle bien eu lieu ? Sans ce témoin, un `BLOCK_DDL` qui
 * cesserait d'être inséré tel quel dans le DDL laisserait passer une « base
 * v5 » qui porte déjà la table — et la migration ne serait plus éprouvée.
 */
export const DDL_V5_EST_DERIVE =
  DDL_V5 !== DDL && !DDL_V5.includes('block') && DDL.includes(BLOCK_DDL);
