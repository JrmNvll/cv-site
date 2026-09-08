/**
 * Navigation consciente de la langue — les composants utilisent ces API plutôt
 * que `next/link` et `next/navigation`, afin que le préfixe de langue soit
 * toujours appliqué (AD-5).
 */
import {createNavigation} from 'next-intl/navigation';
import {routing} from './routing';

export const {Link, redirect, usePathname, useRouter, getPathname} = createNavigation(routing);
