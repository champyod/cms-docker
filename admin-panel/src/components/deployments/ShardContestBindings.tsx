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

/** Each shard binds its own contest, so several shards can serve different contests at once. */
export function ShardContestBindings({ bindings, contests, emptyText }: ShardContestBindingsProps): React.JSX.Element {
  const nameOf = new Map(contests.map((contest) => [contest.id, contest.name]));
  const label = (contestId: number): string => {
    const name = nameOf.get(contestId);
    return name === undefined ? `#${contestId}` : `#${contestId}: ${name}`;
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
