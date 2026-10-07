'use client';

import { InlineAlert } from '@/components/core/InlineAlert';

export function UnsavedRestartBanner({ services }: { services: string[] }) {
  return (
    <InlineAlert
      tone="warning"
      title="Unsaved Changes Require Restart"
      className="sticky top-4 z-50 animate-in fade-in slide-in-from-top-2"
    >
      Applying these changes will automatically restart the following services:
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map(s => (
          <span key={s} className="rounded border border-warning/20 bg-warning/15 px-2 py-1 text-warning text-xs">
            {s}
          </span>
        ))}
      </div>
    </InlineAlert>
  );
}
