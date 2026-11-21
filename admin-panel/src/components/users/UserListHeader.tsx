'use client';

import { FileSpreadsheet, HelpCircle, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/core/Button';
import type { Dictionary } from '@/lib/dictionary';

import { UserBulkCreateCsv } from './UserBulkCreateCsv';
import { UserModal } from './UserModal';
import { useUserCapabilities, useUserDialogs } from './useUserListActions';
import { useUserListRefresh } from './useUserListRefresh';

export interface UserListHeaderProps {
  readonly canReadContests: boolean;
  readonly contests: Array<{ id: number; name: string }>;
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: string;
  readonly docsLabel: string;
}

// Why the dialogs live here: the buttons sit in the page header, which renders above
// the list in a different client tree, so the create and bulk-create forms cannot stay
// in the list component without lifting this header's state into the page. Bulk edit is
// absent on purpose — it acts on the list's selection, so it stays beside the table.
export function UserListHeader({
  canReadContests,
  contests,
  permissionKeys,
  navigation,
  locale,
  docsLabel,
}: UserListHeaderProps): React.JSX.Element {
  const capabilities = useUserCapabilities(permissionKeys);
  const dialogs = useUserDialogs();
  const refresh = useUserListRefresh();

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/docs#users`}
          className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground"
          title={docsLabel}
        >
          <HelpCircle className="w-4 h-4" />
        </Link>
        {capabilities.canCreate && (
          <>
            <Button variant="positiveOutline" icon={FileSpreadsheet} onClick={dialogs.openBulkCreate}>
              Bulk Add Users
            </Button>
            <Button variant="positive" icon={Plus} onClick={dialogs.openCreate}>
              Create User
            </Button>
          </>
        )}
      </div>

      <UserModal
        isOpen={dialogs.isOpen}
        onClose={dialogs.close}
        user={dialogs.selectedUser}
        contests={contests}
        canReadContests={canReadContests}
        navigation={navigation}
        onSuccess={refresh}
        permissionKeys={permissionKeys}
      />
      {capabilities.canCreate && (
        <UserBulkCreateCsv
          isOpen={dialogs.isBulkCreateOpen}
          onClose={dialogs.closeBulkCreate}
          contests={contests}
          canReadContests={canReadContests}
          navigation={navigation}
          onSuccess={refresh}
        />
      )}
    </>
  );
}