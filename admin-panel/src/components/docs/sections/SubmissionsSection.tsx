'use client';

import { Activity, Flag } from 'lucide-react';
import { Card } from '@/components/core/Card';

export function SubmissionsSection(): React.JSX.Element {
  return (
    <section id="submissions" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Activity className="h-6 w-6 text-emerald-400" />
          Submissions
        </h2>
      </div>
      <Card className="p-6">
        <p className="text-foreground mb-6">View centralized submission logs. Filter by contest, task, or user to monitor judge performance.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
            <h4 className="font-bold text-emerald-400 text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Automatic Evaluation</h4>
            <p className="text-xs text-emerald-200/70 leading-relaxed">Every submission undergoes compilation, execution, and comparison.</p>
          </div>
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
            <h4 className="font-bold text-amber-400 text-sm flex items-center gap-2"><Flag className="h-4 w-4" />Result Invalidation</h4>
            <p className="text-xs text-amber-200/70 leading-relaxed">If you update testcases or scoring rules, invalidate existing results to force reevaluation.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
