'use client';

/** The services a contest stack runs. The board above supplies the frame, the title and the docs link. */
export function ServicesSection(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div><h3 className="font-medium text-foreground">LogService</h3><p className="text-sm text-muted-foreground">Central logging facility.</p></div>
      <div><h3 className="font-medium text-foreground">ResourceService</h3><p className="text-sm text-muted-foreground">Manages resources and distributes them to workers.</p></div>
      <div><h3 className="font-medium text-foreground">EvaluationService</h3><p className="text-sm text-muted-foreground">Handles compilation and execution of submissions.</p></div>
    </div>
  );
}
