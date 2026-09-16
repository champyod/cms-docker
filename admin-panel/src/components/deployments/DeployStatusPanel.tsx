'use client';

import { Activity, CheckCircle2, Clock3, OctagonAlert, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
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

function LogTail({ log, active }: { log: string; active: boolean }) {
  if (!log.trim()) {
    return <p className="font-mono text-xs text-muted-foreground">{active ? 'Waiting for build output...' : 'No log output available.'}</p>;
  }
  return <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground">{log}</pre>;
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

        <Stack gap={2}>
          <Text variant="label">Build Log</Text>
          <LogTail log={state.log} active={active} />
        </Stack>

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