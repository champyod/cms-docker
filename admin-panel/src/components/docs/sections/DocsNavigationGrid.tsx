'use client';

import Link from 'next/link';
import { Trophy, Users, Code, Activity, Server } from 'lucide-react';
import docs from '@/components/docs/docs.json';

const ICON_MAP = { Trophy, Users, Code, Activity, Server } as const;

export function DocsNavigationGrid(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {docs.navigation.map((item) => {
        const Icon = ICON_MAP[item.icon as keyof typeof ICON_MAP];
        return (
          <Link key={item.id} href={`#${item.id}`} className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
            <Icon className={`h-6 w-6 ${item.color} mb-2 group-hover:scale-110 transition-transform`} />
            <span className="font-medium text-foreground block">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.detail}</span>
          </Link>
        );
      })}
    </div>
  );
}
