'use client';

import { Book } from 'lucide-react';

interface DocsHeaderProps {
  title: string;
  subtitle: string;
  officialDocsLabel: string;
}

export function DocsHeader({ title, subtitle, officialDocsLabel }: DocsHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-border pb-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <a href="https://cms-dev.github.io/cms/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg transition-colors border border-border">
        <Book className="h-4 w-4" />
        {officialDocsLabel}
      </a>
    </div>
  );
}
