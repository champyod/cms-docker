'use client';

import { AlertTriangle } from 'lucide-react';

export function UnsavedRestartBanner({ services }: { services: string[] }) {
  return (
    <div className="sticky top-4 z-50 p-4 bg-warning/10 border border-warning/30 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-bold text-warning">Unsaved Changes Require Restart</h3>
          <p className="text-sm text-foreground/80 mt-1">
            Applying these changes will automatically restart the following services:
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {services.map(s => (
              <span key={s} className="px-2 py-1 bg-warning/15 text-warning text-xs rounded border border-warning/20">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
