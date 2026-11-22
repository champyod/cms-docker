import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/types';

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
}

/**
 * The settings layout: groups, each saying what it changes and for whom.
 *
 * Settings are not a form. Nothing describes a record, several groups may save independently, and
 * the question a reader has is not "what do I type" but "does this change my screen or everyone's".
 * Each group therefore carries a `scope` line that the page cannot omit.
 */
export function SettingsPage({ breadcrumbs, title, description, actions, groups, saveBar, reset }: SettingsPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions}>
      <div className="max-w-3xl space-y-4">
        {groups.map((group) => (
          <Card key={group.key} className="space-y-3 p-4">
            <div>
              <h2 className="text-[length:var(--text-card)] font-semibold">{group.title}</h2>
              <p className="text-muted-foreground">{group.description}</p>
              <p className="text-muted-foreground">{group.scope}</p>
            </div>
            <div className="space-y-3">{group.children}</div>
          </Card>
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
