'use client';

import { useState } from 'react';
import { HelpCircle, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/core/Button';
import type { Dictionary } from '@/lib/dictionary';

import type { TeamListCopy } from './TeamListTable';
import { TeamModal } from './TeamModal';
import { useTeamListRefresh } from './useTeamListRefresh';
import { useTeamCapabilities } from './useTeamListActions';

export interface TeamListHeaderProps {
  readonly locale: string;
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly copy: TeamListCopy;
  /** The affordance label for the docs link, not the documentation's own name. */
  readonly docsLinkLabel: Dictionary['docs']['viewDocumentation'];
}

// Why the create dialog lives here: the button is the page's one primary action and the layout
// renders it in the header, a different client tree from the table. Keeping it in the list would
// mean lifting the table's selection state into the page just to reach the button.
export function TeamListHeader({ locale, permissionKeys, navigation, copy, docsLinkLabel }: TeamListHeaderProps): React.JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const capabilities = useTeamCapabilities(permissionKeys);
  const refresh = useTeamListRefresh();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/docs#users`}
          className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary"
          title={docsLinkLabel}
        >
          <HelpCircle className="w-4 h-4" />
        </Link>
        {capabilities.canCreate && (
          <Button variant="positive" icon={Plus} onClick={() => setIsCreateOpen(true)}>
            {copy.addTeam}
          </Button>
        )}
      </div>
      {capabilities.canCreate && (
        <TeamModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          initialData={null}
          permissionKeys={permissionKeys}
          navigation={navigation}
          onSuccess={() => {
            setIsCreateOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
