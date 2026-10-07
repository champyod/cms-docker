import { cn } from '@/lib/utils';

const DEFAULT_SIDEBAR_WIDTH_CLASS = 'sm:w-64';

interface ResponsiveModalShellProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarWidthClass?: string;
}

// Why: TaskModal, DatasetModal, and ContestModalShell each hand-author the same
// sidebar-on-desktop / topbar-on-mobile class pattern, so fixes drift. This
// component owns that pattern once; modals supply only content.
export function ResponsiveModalShell({
  sidebar,
  children,
  sidebarWidthClass = DEFAULT_SIDEBAR_WIDTH_CLASS,
}: ResponsiveModalShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
      <div
        className={cn(
          'w-full shrink-0 space-y-2 overflow-y-auto border-b border-border bg-muted/20 p-4',
          'max-sm:flex max-sm:flex-row max-sm:flex-wrap max-sm:gap-1 max-sm:space-y-0 max-sm:overflow-x-auto',
          'sm:border-b-0 sm:border-r',
          sidebarWidthClass
        )}
      >
        {sidebar}
      </div>
      <div className="relative min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
