import { CheckCircle2 } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Text } from '@/components/core/Typography';
import type { StatusType } from '@/components/core/StatusBadge';

export interface DashboardStats {
  usersCount: number;
  contestsCount: number;
  activeContestsCount: number;
  submissionsCount: number;
  pendingSubmissions: number;
  activeContesters: number;
}

export interface DashboardActivityRow {
  id: number;
  username: string;
  taskName: string;
  /** Already formatted in the zone of record; the surface never formats time itself. */
  when: string;
}

export interface DashboardServiceState {
  status: StatusType;
  running: number;
  total: number;
  checkedAt: string;
}

export interface DashboardLabels {
  serviceState: Record<StatusType, string>;
  checkedAt: string;
  servicesTitle: string;
  servicesDetail: string;
  stats: {
    totalUsers: string;
    totalContests: string;
    totalSubmissions: string;
    enrolled: string;
    activeNow: string;
    pending: string;
  };
  activity: { title: string; empty: string; user: string; task: string; when: string };
}

/** `{count}` is the only placeholder, so a translator can move it without touching code. */
export function fill(template: string, count: number | string): string {
  return template.replace('{count}', String(count));
}

const ALERT_TONE: Record<StatusType, 'success' | 'warning' | 'destructive'> = {
  ok: 'success',
  degraded: 'warning',
  down: 'destructive',
};

const ROW_HEIGHT = 'h-8'; // 32px, the density default from DESIGN-PREFERENCE topic 5

/**
 * The dashboard as data in, markup out, so the page keeps the queries and this keeps the rules:
 * the state of the service comes before any count (topic 8d: the main message is the state, not
 * the number), colour appears only where it *means* something, and the activity list is a table
 * with 32px rows rather than a stack of cards.
 */
export function DashboardSurface({
  stats,
  service,
  activity,
  labels,
}: {
  stats: DashboardStats;
  service: DashboardServiceState;
  activity: DashboardActivityRow[];
  labels: DashboardLabels;
}): React.JSX.Element {
  const columns: ResponsiveColumn<DashboardActivityRow>[] = [
    {
      key: 'user',
      header: labels.activity.user,
      cellClassName: 'font-medium',
      mobileLabel: labels.activity.user,
      render: (row) => row.username,
    },
    {
      key: 'task',
      header: labels.activity.task,
      mobileLabel: labels.activity.task,
      render: (row) => row.taskName,
    },
    {
      key: 'when',
      header: labels.activity.when,
      headerClassName: 'text-right',
      cellClassName: 'text-right text-muted-foreground whitespace-nowrap',
      mobileLabel: labels.activity.when,
      render: (row) => row.when,
    },
  ];

  return (
    <div className="space-y-4">
      {service.status === 'ok' ? (
        // Nothing is wrong, so nothing interrupts: a quiet line carries the state and its age.
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <span>{labels.serviceState.ok}</span>
          <span aria-hidden>·</span>
          <span>{fill(labels.checkedAt, service.checkedAt)}</span>
        </p>
      ) : (
        <InlineAlert
          tone={ALERT_TONE[service.status]}
          title={labels.serviceState[service.status]}
          announce="polite"
        >
          {`${service.running}/${service.total} · ${fill(labels.stats.pending, stats.pendingSubmissions)}`}
        </InlineAlert>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={labels.stats.totalUsers} value={stats.usersCount} reference={fill(labels.stats.enrolled, stats.activeContesters)} />
        <Stat label={labels.stats.totalContests} value={stats.contestsCount} reference={fill(labels.stats.activeNow, stats.activeContestsCount)} />
        <Stat label={labels.stats.totalSubmissions} value={stats.submissionsCount} reference={fill(labels.stats.pending, stats.pendingSubmissions)} />
        <Stat
          label={labels.servicesTitle}
          value={`${service.running}/${service.total}`}
          reference={labels.servicesDetail}
        />
      </div>

      <Card className="p-0">
        <div className="px-4 py-3">
          <Text variant="h2">{labels.activity.title}</Text>
        </div>
        <ResponsiveTable
          columns={columns}
          rows={activity}
          getRowKey={(row) => row.id}
          getRowClassName={() => ROW_HEIGHT}
          emptyState={<Text variant="muted">{labels.activity.empty}</Text>}
        />
      </Card>
    </div>
  );
}

/**
 * Label, number, reference — the same three slots in every cell, so four cards read as one row.
 * No decorative icon and no colour: a number that is not a status must not look like one.
 */
function Stat({
  label,
  value,
  reference,
}: {
  label: string;
  value: number | string;
  reference: string;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <Text variant="label">{label}</Text>
      <span className="text-[length:var(--text-page)] leading-tight font-semibold tabular-nums">{value}</span>
      <Text variant="muted">{reference}</Text>
    </Card>
  );
}
