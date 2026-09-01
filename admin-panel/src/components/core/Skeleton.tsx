import { EmptyState } from '@/components/core/EmptyState';
import { Skeleton as UISkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const Skeleton = UISkeleton;

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const safeLines = lines ?? 3;
  if (safeLines === null || safeLines <= 0) {
    return <EmptyState title="No content available" description="Nothing to display" />;
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('space-y-2', className)}>
      {Array.from({ length: safeLines }).map((_, index) => (
        <UISkeleton key={index} className={cn('h-4', index === safeLines - 1 && 'w-2/3')} />
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, cols = 4, className }: SkeletonTableProps) {
  const safeRows = rows ?? 5;
  const safeCols = cols ?? 4;
  if (safeRows <= 0 || safeCols <= 0) {
    return <EmptyState title="No data available" description="Table has no rows to display" />;
  }
  return (
    <div role="status" aria-busy="true" className={cn('bg-card rounded-xl border border-border p-4', className)}>
      <div className="flex gap-4 pb-3">
        {Array.from({ length: safeCols }).map((_, index) => (
          <UISkeleton key={index} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: safeRows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 py-2">
          {Array.from({ length: safeCols }).map((_, colIndex) => (
            <UISkeleton key={colIndex} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-card rounded-xl border border-border p-6 space-y-4', className)}>
      <UISkeleton className="h-4 w-1/3" />
      <UISkeleton className="h-8 w-1/2" />
      <SkeletonText lines={2} />
    </div>
  );
}
