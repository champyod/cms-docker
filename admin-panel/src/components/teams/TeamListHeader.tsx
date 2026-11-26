'use client';

import { HelpCircle, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/core/Button';
import type { Dictionary } from '@/lib/dictionary';

import type { TeamListCopy } from './TeamListTable';

export interface TeamListHeaderProps {
  readonly locale: string;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  readonly copy: TeamListCopy;
  /** The affordance label for the docs link, not the documentation's own name. */
  readonly docsLinkLabel: Dictionary['docs']['viewDocumentation'];
}

export function TeamListHeader({ locale, canCreate, onCreate, copy, docsLinkLabel }: TeamListHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link
        href={`/${locale}/docs#users`}
        className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary"
        title={docsLinkLabel}
      >
        <HelpCircle className="w-4 h-4" />
      </Link>
      {canCreate && (
        <Button variant="positive" icon={Plus} onClick={onCreate}>
          {copy.addTeam}
        </Button>
      )}
    </div>
  );
}
