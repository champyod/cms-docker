'use client';

import { DocsHeader } from '@/components/docs/sections/DocsHeader';
import { DocsNavigationGrid } from '@/components/docs/sections/DocsNavigationGrid';
import { ContestsSection } from '@/components/docs/sections/ContestsSection';
import { UsersSection } from '@/components/docs/sections/UsersSection';
import { TasksSection } from '@/components/docs/sections/TasksSection';
import { SubmissionsSection } from '@/components/docs/sections/SubmissionsSection';
import { ServicesSection } from '@/components/docs/sections/ServicesSection';

interface DocsContentProperties {
  title: string;
  subtitle: string;
  officialDocsLabel: string;
}

export function DocsContent({ title, subtitle, officialDocsLabel }: DocsContentProperties): React.JSX.Element {
  return (
    <div className="flex min-h-screen overflow-hidden bg-background">
      <main className="flex flex-1 flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-96 bg-indigo-600/10 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-600/5 blur-2xl rounded-full pointer-events-none translate-y-1/2" />
        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/40">
          <div className="max-w-5xl mx-auto space-y-12">
            <DocsHeader title={title} subtitle={subtitle} officialDocsLabel={officialDocsLabel} />
            <DocsNavigationGrid />
            <ContestsSection />
            <UsersSection />
            <TasksSection />
            <SubmissionsSection />
            <ServicesSection />
          </div>
        </div>
      </main>
    </div>
  );
}
