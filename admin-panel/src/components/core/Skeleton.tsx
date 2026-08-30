import { Skeleton as UISkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const Skeleton = UISkeleton;

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <UISkeleton key={index} className={cn('h-4', index === lines - 1 && 'w-2/3')} />
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
  return (
    <div className={cn('bg-card rounded-xl border border-border p-4', className)}>
      <div className="flex gap-4 pb-3">
        {Array.from({ length: cols }).map((_, index) => (
          <UISkeleton key={index} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, colIndex) => (
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
