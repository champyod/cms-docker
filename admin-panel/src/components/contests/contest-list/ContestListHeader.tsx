'use client';

import Link from 'next/link';
import { Plus, HelpCircle } from 'lucide-react';
import { Button } from '@/components/core/Button';

interface Props { locale: string; canManage: boolean; onCreate: () => void; }

export function ContestListHeader({ locale, canManage, onCreate }: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-foreground">All Contests</h2>
        <Link
          href={`/${locale}/docs#contests`}
          className="flex h-11 w-11 items-center justify-center rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="View Documentation"
        >
          <HelpCircle className="h-4 w-4" />
        </Link>
      </div>
      {canManage && (
        <Button variant="positive" icon={Plus} onClick={onCreate}>Create Contest</Button>
      )}
    </div>
  );
}
