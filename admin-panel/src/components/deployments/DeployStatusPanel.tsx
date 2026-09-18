'use client';

import { useEffect, useRef, useState } from 'react';

import { Activity, CheckCircle2, ChevronsDown, Clock3, OctagonAlert, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { cn } from '@/lib/utils';
import type { DeployState, DeployPhase } from '@/hooks/useDeployContest';

interface DeployStatusPanelProps {
  state: DeployState;
  onCancel: () => void;
  onReset: () => void;
}

interface PhaseMeta {
  label: string;
  icon: LucideIcon;
  badgeClass: string;
  barClass: string;
}

const PHASE_META: Record<DeployPhase, PhaseMeta> = {
  idle: { label: 'Idle', icon: Activity, badgeClass: 'bg-muted text-muted-foreground border-border', barClass: 'bg-primary' },
  deploying: { label: 'Starting', icon: Activity, badgeClass: 'bg-primary/15 text-primary border-primary/25', barClass: 'bg-primary' },
  polling: { label: 'Running', icon: Activity, badgeClass: 'bg-primary/15 text-primary border-primary/25', barClass: 'bg-primary' },
  completed: { label: 'Completed', icon: CheckCircle2, badgeClass: 'bg-success/15 text-success border-success/25', barClass: 'bg-success' },
  failed: { label: 'Failed', icon: XCircle, badgeClass: 'bg-destructive/15 text-destructive border-destructive/25', barClass: 'bg-destructive' },
  timeout: { label: 'Timed Out', icon: Clock3, badgeClass: 'bg-destructive/15 text-destructive border-destructive/25', barClass: 'bg-destructive' },
  already_running: { label: 'Already Running', icon: OctagonAlert, badgeClass: 'bg-warning/15 text-warning border-warning/25', barClass: 'bg-warning' },
};

function isActivePhase(phase: DeployPhase): boolean {
  return phase === 'deploying' || phase === 'polling';
}

function isTerminalPhase(phase: DeployPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'timeout' || phase === 'already_running';
}

function displayPercent(state: DeployState): number | null {
  if (state.status === 'completed') return 100;
  return state.percent;
}

function formatStartTime(startedAt: string | null): string {
  if (!startedAt) return 'Recent';
  const time = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `started ${time}`;
}

function ProgressBar({ percent, barClass }: { percent: number | null; barClass: string }) {
  if (percent !== null) {
    const width = Math.min(100, Math.max(0, percent));
    return (
      <div className="h-2 w-full rounded-full bg-muted" aria-hidden>
        <div className={cn('h-2 rounded-full transition-all duration-500', barClass)} style={{ width: `${width}%` }} />
      </div>
    );
  }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn('h-2 w-1/3 animate-pulse rounded-full', barClass)} />
    </div>
  );
}

// Slack for sub-pixel scroll metrics and for a tail that is a line off the true bottom but still
// reads as "watching the newest output".
export const LOG_BOTTOM_THRESHOLD_PX = 24;

interface LogScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Decides whether the build log should follow new output from the view's current position.
 *
 * Why distance from the bottom rather than the previous follow flag: a programmatic jump to the
 * newest line and an operator scrolling down to it arrive at the same position and mean the same
 * thing, so neither needs to be treated as an interruption. Only moving away from the bottom means
 * the operator is reading history and the tail must stop moving under them.
 */
export function resolveLogFollow({ scrollTop, scrollHeight, clientHeight }: LogScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= LOG_BOTTOM_THRESHOLD_PX;
}

function hasLogOutput(log: string): boolean {
  return log.trim().length > 0;
}

function LogFollowToggle({ autoScroll, onToggle }: { autoScroll: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <Button
      variant={autoScroll ? 'positive' : 'secondary'}
      size="sm"
      icon={ChevronsDown}
      className="rounded-full text-xs font-bold tracking-wider uppercase"
      aria-pressed={autoScroll}
      onClick={onToggle}
    >
      {autoScroll ? 'AUTO-SCROLL ON' : 'AUTO-SCROLL OFF'}
    </Button>
  );
}

interface LogBodyProps {
  log: string;
  active: boolean;
  logReference: React.RefObject<HTMLPreElement | null>;
  onScroll: () => void;
}

function LogBody({ log, active, logReference, onScroll }: LogBodyProps): React.JSX.Element {
  if (!hasLogOutput(log)) {
    return <p className="font-mono text-xs text-muted-foreground">{active ? 'Waiting for build output...' : 'No log output available.'}</p>;
  }
  return (
    <pre
      ref={logReference}
      onScroll={onScroll}
      className="max-h-56 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground"
    >
      {log}
    </pre>
  );
}

interface LogTailProps {
  log: string;
  active: boolean;
}

function LogTail({ log, active }: LogTailProps): React.JSX.Element {
  const logReference = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // The stream replaces the whole log string each frame, so growth is observed on the value itself.
  useEffect(() => {
    if (autoScroll && logReference.current) logReference.current.scrollTop = logReference.current.scrollHeight;
  }, [log, autoScroll]);

  function handleScroll(): void {
    const element = logReference.current;
    if (element) setAutoScroll(resolveLogFollow(element));
  }

  function handleToggleAutoScroll(): void {
    if (autoScroll) {
      setAutoScroll(false);
      return;
    }
    const element = logReference.current;
    if (element) element.scrollTop = element.scrollHeight;
    // The click is the operator asking for the newest line, so following resumes with it.
    setAutoScroll(true);
  }

  return (
    <Stack gap={2}>
      <Stack direction="row" align="center" justify="between">
        <Text variant="label">Build Log</Text>
        {hasLogOutput(log) && <LogFollowToggle autoScroll={autoScroll} onToggle={handleToggleAutoScroll} />}
      </Stack>
      <LogBody log={log} active={active} logReference={logReference} onScroll={handleScroll} />
    </Stack>
  );
}

export function DeployStatusPanel({ state, onCancel, onReset }: DeployStatusPanelProps) {
  const { phase } = state;
  const meta = PHASE_META[phase];
  const active = isActivePhase(phase);
  const terminal = isTerminalPhase(phase);
  const percent = displayPercent(state);

  return (
    <Card className="p-6">
      <Stack gap={4}>
        <Stack direction="row" align="center" justify="between">
          <Stack direction="row" align="center" gap={3}>
            <meta.icon className="h-5 w-5 text-primary" aria-hidden />
            <Text variant="h3">Deployment Status</Text>
            <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', meta.badgeClass)}>
              {meta.label}
            </span>
          </Stack>
          <Text variant="small" color="text-muted-foreground">{formatStartTime(state.startedAt)}</Text>
        </Stack>

        <Stack gap={2}>
          <Stack direction="row" align="center" justify="between">
            <Text variant="label">Progress</Text>
            <Text variant="small" color="text-muted-foreground">{percent !== null ? `${percent}%` : 'Pending build output'}</Text>
          </Stack>
          <ProgressBar percent={percent} barClass={meta.barClass} />
        </Stack>

        {phase !== 'idle' && state.error && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
            <Stack direction="row" gap={3} align="start">
              <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
              <Text variant="small" color="text-foreground">{state.error}</Text>
            </Stack>
          </div>
        )}

        {state.warning && (
          <div className="rounded-lg border border-warning/25 bg-warning/10 p-3">
            <Stack direction="row" gap={3} align="start">
              <OctagonAlert className="h-5 w-5 shrink-0 text-warning" aria-hidden />
              <Text variant="small" color="text-foreground">{state.warning}</Text>
            </Stack>
          </div>
        )}

        <LogTail log={state.log} active={active} />

        <Stack direction="row" gap={3} justify="end">
          {active && (
            <Button variant="secondary" onClick={onCancel}>
              Cancel Deployment
            </Button>
          )}
          {terminal && (
            <Button variant="secondary" onClick={onReset}>
              Dismiss
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}