'use client';

import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { AlertTriangle } from 'lucide-react';
import type { ShardContestBinding } from '@/lib/service-wiring-contract';
import { ShardContestBindings } from '@/components/deployments/ShardContestBindings';

export interface ContestOption {
  id: number;
  name: string;
  is_active: boolean;
}

interface ActiveContestCardProps {
  /** The registry rows that bind a shard to a contest: the card's whole content, per shard. */
  shardBindings: readonly ShardContestBinding[];
  activeContestId: number | null;
  activeContestName: string | null;
  availableContests: ContestOption[];
}

/** Moving a shard is a registry write a running instance re-reads; recreating the stack could restart the board mid-contest. */
export function ActiveContestCard({
  shardBindings,
  activeContestId,
  activeContestName,
  availableContests,
}: ActiveContestCardProps) {
  return (
    <Stack gap={5}>
      <Text variant="small" color="text-muted-foreground">
        From the service registry: the contest each bound shard serves. A registry row decides
        what a running instance serves, so these rows, not one active id, are what is live.
      </Text>

      <ShardContestBindings
        bindings={shardBindings}
        contests={availableContests}
        emptyText="No enabled registry row binds a shard to a contest."
      />

      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <Stack direction="row" align="center" gap={3}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Text variant="small" color="text-muted-foreground">
            {activeContestId
              ? `Deployment default (contests.is_active): #${activeContestId}${activeContestName ? `: ${activeContestName}` : ''}. Applies only to an instance no registry row names.`
              : 'No deployment default (contests.is_active) is set; an instance no registry row names serves no contest.'}
          </Text>
        </Stack>
      </div>
    </Stack>
  );
}
