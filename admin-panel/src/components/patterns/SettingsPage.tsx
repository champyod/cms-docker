import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import { SectionCard } from '@/components/core/SectionCard';
import type { PageSlots } from '@/components/patterns/page-types';

export interface SettingsGroup {
  /** Stable key, used to report which group changed. */
  readonly key: string;
  readonly title: string;
  /** What the group controls, in the words the person would use. */
  readonly description: string;
  /** Who the change affects. Never left implicit: a screen preference and a system rule look alike. */
  readonly scope: string;
  readonly children: ReactNode;
}

export interface SettingsPageProps extends Omit<PageSlots, 'children'> {
  readonly groups: readonly SettingsGroup[];
  /** The save bar for the whole page; absent when every group saves itself on change. */
  readonly saveBar?: ReactNode;
  readonly reset?: ReactNode;
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

/**
 * The settings layout: groups, each saying what it changes and for whom.
 *
 * Settings are not a form. Nothing describes a record, several groups may save independently, and
 * the question a reader has is not "what do I type" but "does this change my screen or everyone's".
 * Each group therefore carries a `scope` line that the page cannot omit.
 *
 * A group is a section, so it is drawn by the section frame rather than by a second card written
 * here: the heading level, the title size and the padding are the panel's, and a settings group that
 * chose its own weight would be the one place a section looked different.
 */
export function SettingsPage({
  breadcrumbs,
  title,
  description,
  actions,
  groups,
  saveBar,
  reset,
  ownsHeader = true,
}: SettingsPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="max-w-3xl space-y-4">
        {groups.map((group) => (
          <SectionCard
            key={group.key}
            title={group.title}
            description={group.description}
            note={group.scope}
          >
            <div className="space-y-3">{group.children}</div>
          </SectionCard>
        ))}
        {(saveBar || reset) && (
          <div className="flex items-center gap-2">
            {saveBar}
            {reset}
          </div>
        )}
      </div>
    </PageSurface>
  );
}
