'use client';

import { Trophy } from 'lucide-react';
import { Card } from '@/components/core/Card';
import docs from '@/components/docs/docs.json';

export function ContestsSection(): React.JSX.Element {
  return (
    <section id="contests" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Trophy className="h-6 w-6 text-amber-400" />
          {docs.sections.contests.title}
        </h2>
        <a href={docs.sections.contests.docsUrl} target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
      </div>
      <Card className="p-6">
        <p className="text-foreground mb-4">A contest is the main container for tasks and users. You can define start and stop times, allowed languages, and participation rules.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-foreground mb-2 underline decoration-indigo-500/30">Contest Timing</h3>
            <ul className="text-sm text-muted-foreground space-y-3">
              <li><strong className="text-foreground">Start and Stop Time:</strong><p className="text-xs mt-1">UTC interval when contest is active.</p></li>
              <li><strong className="text-foreground">Analysis Mode:</strong><p className="text-xs mt-1">Optional period after Stop Time for detailed results.</p></li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-2 underline decoration-indigo-500/30">Submission Limits</h3>
            <ul className="text-sm text-muted-foreground space-y-3">
              <li><strong className="text-foreground">Token Mode:</strong><p className="text-xs mt-1">Disabled / Infinite / Limited bucket system.</p></li>
              <li><strong className="text-foreground">Minimum Interval:</strong><p className="text-xs mt-1">Wait time in seconds between submissions.</p></li>
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}
