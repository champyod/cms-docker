'use client';

import { Terminal } from 'lucide-react';

/**
 * What a task, its datasets and its scoring are.
 *
 * WHY the panels are bordered divs and not Cards: the board already frames this section, so a Card
 * here would be a card inside a card. The three headings that used to be a second colour are plain
 * foreground, because the page is measured in four modes and a palette step is not.
 */
export function TasksSection(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-2 font-bold text-foreground underline decoration-border">Task Types</h3>
          <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Batch:</strong> Reads input, produces output.</li>
            <li><strong className="text-foreground">Communication:</strong> Two programs via manager.</li>
            <li><strong className="text-foreground">OutputOnly:</strong> Upload precomputed outputs.</li>
            <li><strong className="text-foreground">TwoSteps:</strong> Program run twice.</li>
          </ul>
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3">
            <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground"><Terminal className="h-3 w-3" />Manager Files</h4>
            <div className="space-y-2 text-xs"><code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">checker</code>: validates output. <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">grader</code>: driver for communication.</div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-2 font-bold text-foreground underline decoration-border">Datasets</h3>
          <p className="text-sm text-muted-foreground">A task can have multiple datasets, only one Active. Testcases: input/output pairs.</p>
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Common Fields</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li><strong className="text-foreground">Time Limit:</strong> CPU time per testcase.</li>
              <li><strong className="text-foreground">Memory Limit:</strong> Address space allowed.</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border p-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-2"><h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Score Modes</h3><ul className="space-y-1 text-xs text-muted-foreground"><li><strong className="text-foreground">Max:</strong> Best across submissions.</li><li><strong className="text-foreground">Max subtask:</strong> Best per subtask.</li></ul></div>
          <div className="space-y-2"><h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Feedback Levels</h3><ul className="space-y-1 text-xs text-muted-foreground"><li><strong className="text-foreground">Restricted:</strong> Total score only.</li><li><strong className="text-foreground">Full:</strong> Detailed metrics.</li></ul></div>
          <div className="space-y-2"><h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Score Types</h3><ul className="space-y-1 text-xs text-muted-foreground"><li><strong className="text-foreground">Sum:</strong> Sum of subtasks.</li><li><strong className="text-foreground">GroupMin:</strong> All must pass.</li></ul></div>
        </div>
      </div>
    </div>
  );
}
