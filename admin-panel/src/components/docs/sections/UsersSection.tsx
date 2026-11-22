'use client';

/** How users, teams and participations relate. The board above supplies the frame and the title. */
export function UsersSection(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 font-bold text-foreground">Teams</h3>
        <p className="text-sm text-muted-foreground">Users are grouped into Teams. Use teams to bulk add users or filter scoreboards.</p>
      </div>
      <div className="border-t border-border pt-4">
        <h3 className="mb-2 font-bold text-foreground">Participation Settings</h3>
        <p className="mb-4 text-sm text-muted-foreground">When a user is added to a contest, a Participation object tracks constraints.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Time Adjustments</span>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              <li><strong className="text-foreground">Extra Time:</strong> Minutes added to duration.</li>
              <li><strong className="text-foreground">Delay Time:</strong> Minutes before user can log in.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Security Flags</span>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              <li><strong className="text-foreground">Unrestricted:</strong> Bypasses IP restrictions.</li>
              <li><strong className="text-foreground">Hidden:</strong> Excluded from public scoreboard.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
