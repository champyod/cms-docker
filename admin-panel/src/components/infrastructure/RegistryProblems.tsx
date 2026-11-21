'use client';

import { interpolate } from '@/lib/interpolate';
import type { WiringProblem } from '@/lib/service-wiring-problems';
import type { ServicesCopy } from './registry-spec';

/**
 * Every fault a sync would refuse, listed before it is run.
 *
 * WHY its own component: the registry screen holds the state and this holds the reading, so the screen
 * stays under one screenful and the strip can be rendered without mounting the editors.
 */
export function RegistryProblems({
  problems,
  copy,
}: {
  readonly problems: readonly WiringProblem[];
  readonly copy: ServicesCopy;
}): React.JSX.Element | null {
  if (problems.length === 0) return null;
  return (
    <section className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
      <h2 className="text-sm font-medium text-destructive">
        {interpolate(problems.length === 1 ? copy.problems.one : copy.problems.title, { count: problems.length })}
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {problems.map((problem) => (
          <li key={`${problem.area}:${problem.message}`}>{problem.message}</li>
        ))}
      </ul>
    </section>
  );
}
