'use client';

import { ArrowDownToLine } from 'lucide-react';

import { cn } from '@/lib/utils';

interface LogFollowButtonProps {
  following: boolean;
  onClick: () => void;
  className?: string;
}

export function LogFollowButton({ following, onClick, className }: LogFollowButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      title={following ? 'Following latest logs — click to pause' : 'Paused — click to jump to latest and resume'}
      className={cn(
        'flex size-11 items-center justify-center rounded-full border shadow-lg transition-all',
        following
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'animate-bounce border-border bg-background/90 text-foreground hover:border-primary/60',
        className,
      )}
    >
      <ArrowDownToLine className="size-4" aria-hidden />
    </button>
  );
}
