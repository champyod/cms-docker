import React from 'react';

import { EmptyState } from '@/components/core/EmptyState';
import { TableElement } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  outerClassName?: string;
  mobileCards?: React.ReactNode;
}

// Why this container is here and not the adapter: the bordered card wrapper and
// the mobile-cards switch are list policy; the table elements come from the
// adapter, which owns their surfaces.
const TABLE_FRAME = "w-full overflow-auto rounded-xl border border-border bg-card shadow-sm";
const MOBILE_CARD_STACK = "space-y-3 md:hidden";
const DESKTOP_HIDDEN_UNTIL_MD = "hidden md:block";

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, children, outerClassName, mobileCards, ...props }, ref) => {
    const isEmpty = children === null || children === undefined;
    if (isEmpty) {
      return <EmptyState title="No data available" description="Table has no rows to display" />;
    }
    const table = (
      <TableElement ref={ref} className={className} {...props}>
        {children}
      </TableElement>
    );
    if (mobileCards) {
      return (
        <>
          <div className={MOBILE_CARD_STACK}>{mobileCards}</div>
          <div className={cn(TABLE_FRAME, DESKTOP_HIDDEN_UNTIL_MD, outerClassName)}>{table}</div>
        </>
      );
    }
    return <div className={cn(TABLE_FRAME, outerClassName)}>{table}</div>;
  }
);
Table.displayName = "Table";

export {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
