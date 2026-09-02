'use client';

import { Server } from 'lucide-react';
import { Card } from '@/components/core/Card';
import docs from '@/components/docs/docs.json';

export function ServicesSection(): React.JSX.Element {
  return (
    <section id="services" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Server className="h-6 w-6 text-purple-400" />
          {docs.sections.services.title}
        </h2>
        <a href={docs.sections.services.docsUrl} target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
      </div>
      <Card className="p-6">
        <div className="space-y-4">
          <div><h3 className="text-foreground font-medium">LogService</h3><p className="text-sm text-muted-foreground">Central logging facility.</p></div>
          <div><h3 className="text-foreground font-medium">ResourceService</h3><p className="text-sm text-muted-foreground">Manages resources and distributes them to workers.</p></div>
          <div><h3 className="text-foreground font-medium">EvaluationService</h3><p className="text-sm text-muted-foreground">Handles compilation and execution of submissions.</p></div>
        </div>
      </Card>
    </section>
  );
}
