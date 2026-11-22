'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, HelpCircle } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { ContestModal } from '../ContestModal';
import { useContestListRefresh } from './useContestListRefresh';

interface Props {
  readonly locale: string;
  readonly canCreate: boolean;
  readonly permissionKeys: readonly string[];
}

// Why the create dialog lives here: the button is the page's one primary action and the layout
// renders it in the header, a different client tree from the table. Keeping the dialog in the
// list would mean lifting the table's selection state into the page just to reach the button.
export function ContestListHeader({ locale, canCreate, permissionKeys }: Props) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const refresh = useContestListRefresh();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/docs#contests`}
          className="flex h-11 w-11 items-center justify-center rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="View Documentation"
        >
          <HelpCircle className="h-4 w-4" />
        </Link>
        {canCreate && (
          <Button variant="positive" icon={Plus} onClick={() => setIsCreateOpen(true)}>
            Create Contest
          </Button>
        )}
      </div>
      {canCreate && (
        <ContestModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          contest={null}
          onSuccess={() => {
            setIsCreateOpen(false);
            refresh();
          }}
          permissionKeys={permissionKeys}
        />
      )}
    </>
  );
}
