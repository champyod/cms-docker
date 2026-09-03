'use client';

import { Code, Terminal } from 'lucide-react';
import { Card } from '@/components/core/Card';
import docs from '@/components/docs/docs.json';

export function TasksSection(): React.JSX.Element {
  return (
    <section id="tasks" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Code className="h-6 w-6 text-indigo-400" />
          {docs.sections.tasks.title}
        </h2>
        <a href={docs.sections.tasks.docsUrl} target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-2 underline decoration-indigo-500/30">Task Types</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li><strong className="text-foreground">Batch:</strong> Reads input, produces output.</li>
            <li><strong className="text-foreground">Communication:</strong> Two programs via manager.</li>
            <li><strong className="text-foreground">OutputOnly:</strong> Upload precomputed outputs.</li>
            <li><strong className="text-foreground">TwoSteps:</strong> Program run twice.</li>
          </ul>
          <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
            <h4 className="font-bold text-indigo-400 text-xs uppercase tracking-wider mb-2 flex items-center gap-2"><Terminal className="h-3 w-3" />Manager Files</h4>
            <div className="space-y-2 text-xs"><code className="bg-muted px-1 py-0.5 rounded text-amber-200">checker</code> — validates output. <code className="bg-muted px-1 py-0.5 rounded text-amber-200">grader</code> — driver for communication.</div>
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-2 underline decoration-indigo-500/30">Datasets</h3>
          <p className="text-sm text-muted-foreground">A task can have multiple datasets, only one Active. Testcases: input/output pairs.</p>
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <h4 className="font-bold text-foreground text-xs uppercase tracking-wider">Common Fields</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li><strong className="text-foreground">Time Limit:</strong> CPU time per testcase.</li>
              <li><strong className="text-foreground">Memory Limit:</strong> Address space allowed.</li>
            </ul>
          </div>
        </Card>
      </div>
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2"><h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Modes</h3><ul className="text-xs text-muted-foreground space-y-1"><li><strong className="text-foreground">Max:</strong> Best across submissions.</li><li><strong className="text-foreground">Max subtask:</strong> Best per subtask.</li></ul></div>
          <div className="space-y-2"><h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Feedback Levels</h3><ul className="text-xs text-muted-foreground space-y-1"><li><strong className="text-foreground">Restricted:</strong> Total score only.</li><li><strong className="text-foreground">Full:</strong> Detailed metrics.</li></ul></div>
          <div className="space-y-2"><h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Types</h3><ul className="text-xs text-muted-foreground space-y-1"><li><strong className="text-foreground">Sum:</strong> Sum of subtasks.</li><li><strong className="text-foreground">GroupMin:</strong> All must pass.</li></ul></div>
        </div>
      </Card>
    </section>
  );
}
