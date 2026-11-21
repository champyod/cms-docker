import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { ShardContestBinding } from '@/lib/service-wiring-contract';

/** The contest a row serves is named when the contest list knows it, and shown as its id when not. */
export interface NamedContest {
  readonly id: number;
  readonly name: string;
}

interface ShardContestBindingsProps {
  readonly bindings: readonly ShardContestBinding[];
  readonly contests: readonly NamedContest[];
  readonly emptyText: string;
}

/**
 * One row per registry binding: the shard, the service role, and the contest that shard serves.
 *
 * WHY a table and not a single id: the registry binds each instance's shard to its own contest and
 * cms.db.contest_binding reads that row per call, so several shards can serve different contests at
 * once — one id cannot say that. The rows are the registry's own, so the panel cannot disagree with
 * what a running instance serves. It is read-only on purpose: changing a binding is the registry
 * editor's job, and nothing here restarts a stack.
 */
export function ShardContestBindings({ bindings, contests, emptyText }: ShardContestBindingsProps): React.JSX.Element {
  const nameOf = new Map(contests.map((contest) => [contest.id, contest.name]));
  const label = (contestId: number): string => {
    const name = nameOf.get(contestId);
    return name === undefined ? `#${contestId}` : `#${contestId} — ${name}`;
  };
  const columns: ResponsiveColumn<ShardContestBinding>[] = [
    { key: 'shard', header: 'Shard', render: (binding) => `shard ${binding.shard}` },
    { key: 'role', header: 'Service role', render: (binding) => binding.role },
    { key: 'contest', header: 'Contest served', render: (binding) => label(binding.contestId) },
  ];
  return (
    <ResponsiveTable
      columns={columns}
      rows={[...bindings]}
      getRowKey={(binding) => binding.id}
      emptyState={<EmptyState title={emptyText} />}
    />
  );
}
