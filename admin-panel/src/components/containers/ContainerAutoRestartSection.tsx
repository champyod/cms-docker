'use client';

import { Power } from 'lucide-react';
import { InlineAlert } from '@/components/core/InlineAlert';
import { cn } from '@/lib/utils';

interface ContainerAutoRestartSectionProps {
  autoRestart: boolean;
  onToggle: () => void;
}

export function ContainerAutoRestartSection({ autoRestart, onToggle }: ContainerAutoRestartSectionProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-bold text-foreground flex items-center gap-2">
            <Power className="w-4 h-4 text-success" />
            Auto-Restart Policy
          </label>
          <p className="text-xs text-muted-foreground mt-1">
            Automatically restart container on failure
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoRestart}
          aria-label={`Auto-restart ${autoRestart ? 'enabled' : 'disabled'} — click to ${autoRestart ? 'disable' : 'enable'}`}
          onClick={onToggle}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span
            className={cn(
              'pointer-events-none relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              autoRestart ? 'bg-success' : 'bg-muted'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-card transition-transform',
                autoRestart ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </span>
        </button>
      </div>

      {!autoRestart && (
        <InlineAlert tone="warning" density="compact">
          Container will NOT restart automatically on failure. You must start it manually via the UI.
        </InlineAlert>
      )}
    </div>
  );
}
