import type { ReactNode } from 'react';

import type { BreadcrumbItem } from '@/lib/navigation/types';

/**
 * The page layouts. A page names one and fills its slots; it never draws layout of its own.
 *
 * There is no `form` kind. Every create and edit in this panel is a dialog that keeps the list
 * visible behind it, so a page-level form has no consumer - and a layout nothing renders is a
 * template whose rules were never tested against real data.
 */
export const PAGE_ARCHETYPES = ['dashboard', 'list', 'detail', 'settings', 'board', 'modes', 'redirect'] as const;

export type PageArchetype = (typeof PAGE_ARCHETYPES)[number];

/**
 * `redirect` is not a layout - it is a route that forwards an old address to its canonical one
 * and renders nothing. It is declared for the same reason the others are: two addresses quietly
 * rendering the same page is how they start to disagree about it.
 */
export type PageLayoutKind = Exclude<PageArchetype, 'redirect'>;

/** Slots every archetype understands. A slot left empty renders nothing, never a placeholder. */
export interface PageSlots {
  // Why optional: a page under a module shell has its trail rendered by that shell, and the trail
  // itself may only come from the navigation builders - so the honest value for such a page is
  // no value, not an empty array it had to write by hand.
  readonly breadcrumbs?: readonly BreadcrumbItem[];
  // Optional because a page under a module shell is named by that shell; requiring a title there
  // only produced `title=""`, a required prop carrying nothing.
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  /** The single primary action of the page. More than one belongs in the page, not the header. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A page that declares a layout must render the component for it, so the declaration and the
 * code cannot drift apart.
 */
export interface ArchetypeDeclaration {
  readonly kind: PageArchetype;
}
