'use client';

import { Activity, Flag } from 'lucide-react';

/** What happens to a submission after it is sent. The board above supplies the frame and the title. */
export function SubmissionsSection(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-foreground">View centralized submission logs. Filter by contest, task, or user to monitor judge performance.</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-success/20 bg-success/10 p-4 high-contrast:border-success high-contrast:bg-success/20">
          <h4 className="flex items-center gap-2 text-sm font-bold text-success"><Activity className="h-4 w-4" />Automatic Evaluation</h4>
          <p className="text-xs leading-relaxed text-success/80">Every submission undergoes compilation, execution, and comparison.</p>
        </div>
        <div className="space-y-2 rounded-xl border border-warning/20 bg-warning/10 p-4 high-contrast:border-warning high-contrast:bg-warning/20">
          <h4 className="flex items-center gap-2 text-sm font-bold text-warning"><Flag className="h-4 w-4" />Result Invalidation</h4>
          <p className="text-xs leading-relaxed text-warning/80">If you update testcases or scoring rules, invalidate existing results to force reevaluation.</p>
        </div>
      </div>
    </div>
  );
}
