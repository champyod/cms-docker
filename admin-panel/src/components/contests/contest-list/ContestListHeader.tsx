'use client';

import Link from 'next/link';
import { Plus, HelpCircle } from 'lucide-react';
import { Button } from '@/components/core/Button';

interface Props { locale: string; canManage: boolean; onCreate: () => void; }

export function ContestListHeader({ locale, canManage, onCreate }: Props) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-foreground">All Contests</h2>
        <Link
          href={`/${locale}/docs#contests`}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
