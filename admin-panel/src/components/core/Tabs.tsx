import Link from 'next/link';

import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  href?: string;
}

interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  ariaLabel: string;
  className?: string;
  onSelect?: (id: string) => void;
}

const TAB_BASE = 'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors';
const TAB_ACTIVE = 'border-primary text-primary';
const TAB_INACTIVE = 'border-transparent text-muted-foreground hover:text-foreground';

/**
 * Tab strip whose selection lives in the URL (items with href) or in local
 * state (items without href + onSelect).
 *
 * Why links inside a labelled nav rather than the ARIA tab pattern: each tab is its own addressable
 * page state, so browser history and middle-click/open-in-new-tab come for free — the ARIA pattern
 * would replace that with roving-tabindex keyboard handling and a single shared panel.
 */
export function Tabs({ items, activeId, ariaLabel, className, onSelect }: TabsProps): React.JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <nav aria-label={ariaLabel} className={cn('flex border-b border-border', className)}>
      {items.map((item) => {
        const isActive = item.id === activeId;
        const tabClassName = cn(TAB_BASE, isActive ? TAB_ACTIVE : TAB_INACTIVE);
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={tabClassName}
            >
              {item.label}
            </Link>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect?.(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={tabClassName}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
