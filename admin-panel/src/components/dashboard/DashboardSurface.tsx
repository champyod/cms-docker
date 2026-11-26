import { CheckCircle2 } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ROW_HEIGHT_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { StatGrid } from '@/components/core/StatGrid';
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
  /** Named, because a count cannot tell the reader what to fix. */
  down: { name: string; state: string }[];
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

/** Data in, markup out: the page keeps the queries and this keeps the rules. */
export function DashboardSurface({
  activity,
  labels,
  locale,
}: {
  activity: DashboardActivityRow[];
  labels: DashboardLabels;
  locale?: string;
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
    <Card className="p-0">
      <div className="px-4 py-3">
        <Text variant="h2">{labels.activity.title}</Text>
      </div>
      <ResponsiveTable
        columns={columns}
        rows={activity}
        getRowKey={(row) => row.id}
        getRowClassName={() => ROW_HEIGHT_CLASS}
        emptyState={<Text variant="muted">{labels.activity.empty}</Text>}
      />
    </Card>
  );
}

/** A number that is not a status must not look like one. */
export function DashboardState({
  service,
  labels,
  stats,
}: {
  service: DashboardServiceState;
  labels: DashboardLabels;
  stats: Pick<DashboardStats, 'pendingSubmissions'>;
}): React.JSX.Element {
  if (service.status === 'ok') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        <span>{labels.serviceState.ok},</span>
        <span>{fill(labels.checkedAt, service.checkedAt)}</span>
      </p>
    );
  }
  return (
    <InlineAlert tone={ALERT_TONE[service.status]} title={labels.serviceState[service.status]} announce="polite">
      <p>{`${service.running}/${service.total}, ${fill(labels.stats.pending, stats.pendingSubmissions)}`}</p>
      {service.down.length > 0 && (
        <ul className="mt-2 space-y-1">
          {service.down.map((container) => (
            <li key={container.name} className="flex items-baseline gap-2">
              <span className="font-mono text-xs">{container.name}</span>
              <span className="text-xs">{container.state}</span>
            </li>
          ))}
        </ul>
      )}
    </InlineAlert>
  );
}
