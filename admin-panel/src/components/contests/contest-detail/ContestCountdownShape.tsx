import type { RunnerShapeId } from '@/lib/contest-countdown-runner';

/**
 * The figures the runner can be drawn as. All of them are stroke-only outlines
 * built here, so each takes the stage colour and none carries an asset licence.
 */
export function ContestCountdownShape({ id }: { readonly id: RunnerShapeId }): React.JSX.Element {
  if (id === 'tumbler') {
    return (
      <svg className="countdown-shape countdown-tumbler" viewBox="0 0 48 48">
        <rect x="8" y="8" width="32" height="32" rx="8" />
        <path d="M24 8v32" />
      </svg>
    );
  }

  if (id === 'blob') {
    return (
      <svg className="countdown-shape countdown-blob" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="15" />
      </svg>
    );
  }

  return (
    <svg className="countdown-shape countdown-stickman" viewBox="0 0 40 62">
      <circle cx="20" cy="9" r="6.5" />
      <path d="M20 16V40" />
      <g className="countdown-limb countdown-limb-a"><path d="M20 20 7 33" /></g>
      <g className="countdown-limb countdown-limb-b"><path d="M20 20 33 33" /></g>
      <g className="countdown-limb countdown-limb-b"><path d="M20 40 11 60" /></g>
      <g className="countdown-limb countdown-limb-a"><path d="M20 40 29 60" /></g>
    </svg>
  );
}
