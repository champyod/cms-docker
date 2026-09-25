import type { ReactNode } from 'react';
import Link from 'next/link';

import { PageHeader } from '@/components/core/Layout';
import type { BreadcrumbItem } from '@/lib/navigation/types';

interface SurfaceHeaderProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly status?: ReactNode;
}

function Breadcrumbs({ items }: { readonly items: readonly BreadcrumbItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${item.href ?? 'current'}:${index}`} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SurfaceHeader({
  breadcrumbs,
  title,
  description,
  actions,
  status,
}: SurfaceHeaderProps): React.JSX.Element {
  return (
    <header className="min-w-0 space-y-4" data-testid="surface-header">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title={title}
        description={description}
        actions={
          actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : undefined
        }
        className="gap-3 sm:flex-row sm:items-start sm:justify-between"
      />
      {status && <div data-testid="surface-status">{status}</div>}
    </header>
  );
}
