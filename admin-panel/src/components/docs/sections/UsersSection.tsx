'use client';

import { Users } from 'lucide-react';
import { Card } from '@/components/core/Card';
import docs from '@/components/docs/docs.json';

export function UsersSection(): React.JSX.Element {
  return (
    <section id="users" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Users className="h-6 w-6 text-cyan-400" />
          {docs.sections.users.title}
        </h2>
        <a href={docs.sections.users.docsUrl} target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
      </div>
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-bold text-foreground mb-2">Teams</h3>
          <p className="text-sm text-muted-foreground">Users are grouped into Teams. Use teams to bulk add users or filter scoreboards.</p>
        </div>
        <div className="pt-4 border-t border-border">
          <h3 className="font-bold text-foreground mb-2">Participation Settings</h3>
          <p className="text-sm text-muted-foreground mb-4">When a user is added to a contest, a Participation object tracks constraints.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Time Adjustments</span>
              <ul className="text-xs text-muted-foreground mt-2 space-y-2">
                <li><strong className="text-foreground">Extra Time:</strong> Minutes added to duration.</li>
                <li><strong className="text-foreground">Delay Time:</strong> Minutes before user can log in.</li>
              </ul>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Security Flags</span>
              <ul className="text-xs text-muted-foreground mt-2 space-y-2">
                <li><strong className="text-foreground">Unrestricted:</strong> Bypasses IP restrictions.</li>
                <li><strong className="text-foreground">Hidden:</strong> Excluded from public scoreboard.</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
