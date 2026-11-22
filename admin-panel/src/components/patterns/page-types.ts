import type { ReactNode } from 'react';

import type { BreadcrumbItem } from '@/lib/navigation/types';

/**
 * The page layouts. A page names one and fills its slots; it never draws layout of its own.
 *
 * `settings` is separate from `form` on purpose: a form submits values that describe one record,
 * while settings change how the panel behaves and end in a save bar that speaks for several
 * groups at once. Shared, the form grew switch rows it never needed and settings inherited a
 * submit button implying one record.
 */
export const PAGE_ARCHETYPES = ['dashboard', 'list', 'detail', 'form', 'settings', 'board', 'redirect'] as const;

export type PageArchetype = (typeof PAGE_ARCHETYPES)[number];

/**
 * `redirect` is not a layout - it is a route that forwards an old address to its canonical one
 * and renders nothing. It is declared for the same reason the others are: two addresses quietly
 * rendering the same page is how they start to disagree about it.
 */
export type PageLayoutKind = Exclude<PageArchetype, 'redirect'>;

/** Slots every archetype understands. A slot left empty renders nothing, never a placeholder. */
export interface PageSlots {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly title: ReactNode;
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
