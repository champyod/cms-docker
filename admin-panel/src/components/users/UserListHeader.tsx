'use client';

import { FileSpreadsheet, HelpCircle, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/core/Button';

export interface UserListHeaderProps {
  readonly locale: string;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  readonly onBulkCreate: () => void;
}

export function UserListHeader({ locale, canCreate, onCreate, onBulkCreate }: UserListHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link
        href={`/${locale}/docs#users`}
        className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground"
        title="View Documentation"
      >
        <HelpCircle className="w-4 h-4" />
      </Link>
      {canCreate && (
        <>
          <Button variant="positiveOutline" icon={FileSpreadsheet} onClick={onBulkCreate}>
            Bulk Add Users
          </Button>
          <Button variant="positive" icon={Plus} onClick={onCreate}>
            Create User
          </Button>
        </>
      )}
    </div>
  );
}
