'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

// Why each surface lives here: the adapter is the only place a table element's
// look is written, so a core wrapper reuses the element and layers its own
// container, mobile-cards switch and empty-state policy on top.
const TABLE_CONTAINER = 'relative w-full overflow-x-auto';
const TABLE_SURFACE = 'w-full caption-bottom text-sm text-left';

const TableContainer = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="table-container" className={cn(TABLE_CONTAINER, className)} {...props} />
  )
);
TableContainer.displayName = 'TableContainer';

// Why the bare element is exported: the core wrapper owns the bordered frame and
// the mobile-cards switch, so it needs the table element and its surface without
// the adapter's own container.
const TableElement = React.forwardRef<HTMLTableElement, React.ComponentProps<'table'>>(
  ({ className, children, ...props }, ref) => (
    <table ref={ref} data-slot="table" className={cn(TABLE_SURFACE, className)} {...props}>
      {children}
    </table>
  )
);
TableElement.displayName = 'TableElement';

const Table = React.forwardRef<HTMLTableElement, React.ComponentProps<'table'>>(
  ({ className, children, ...props }, ref) => {
    const isEmpty = children === null || children === undefined;
    if (isEmpty) {
      return (
        <TableContainer>
          <div className="text-sm text-muted-foreground text-center py-8">No data available</div>
        </TableContainer>
      );
    }
    return (
      <TableContainer>
        <TableElement ref={ref} className={className} {...props}>
          {children}
        </TableElement>
      </TableContainer>
    );
  }
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'thead'>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} data-slot="table-header" className={cn("[&_tr]:border-b bg-muted/50", className)} {...props} />
  )
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'tbody'>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  )
);
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'tfoot'>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} data-slot="table-footer" className={cn("[&_tr]:border-b bg-muted/50 font-medium", className)} {...props} />
  )
);
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.ComponentProps<'tr'>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/10",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'th'>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      data-slot="table-head"
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-slate-400 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'td'>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      data-slot="table-cell"
      className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0 text-foreground", className)}
      {...props}
    />
  )
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.ComponentProps<'caption'>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  )
);
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableElement,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
