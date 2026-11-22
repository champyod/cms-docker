'use client';

/**
 * What a contest is made of, as this panel defines it.
 *
 * WHY no heading, no card and no docs link: the docs page is a board, so the section frame, the
 * section title and the link out to the official page belong to the layout and are passed as
 * section facts. What is left here is the rows.
 */
export function ContestsSection(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-foreground">
        A contest is the main container for tasks and users. You can define start and stop times,
        allowed languages, and participation rules.
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-medium text-foreground underline decoration-border">Contest Timing</h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Start and Stop Time:</strong><p className="mt-1 text-xs">UTC interval when contest is active.</p></li>
            <li><strong className="text-foreground">Analysis Mode:</strong><p className="mt-1 text-xs">Optional period after Stop Time for detailed results.</p></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-medium text-foreground underline decoration-border">Submission Limits</h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Token Mode:</strong><p className="mt-1 text-xs">Disabled / Infinite / Limited bucket system.</p></li>
            <li><strong className="text-foreground">Minimum Interval:</strong><p className="mt-1 text-xs">Wait time in seconds between submissions.</p></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
