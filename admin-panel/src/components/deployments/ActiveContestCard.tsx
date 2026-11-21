'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Rocket, AlertTriangle } from 'lucide-react';
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

/**
 * The contests this deployment serves, per shard, from the service registry.
 *
 * WHY there is no control here: a shard is moved to another contest by writing its registry row,
 * which a running instance re-reads within seconds — so a lever that activated a contest by
 * recreating the contest stack was the one path that could restart the board mid-contest. The
 * registry screen owns that write; this card states the result.
 */
export function ActiveContestCard({
  shardBindings,
  activeContestId,
  activeContestName,
  availableContests,
}: ActiveContestCardProps) {
    return (
        <Card className="p-6">
            <Stack gap={5}>
                <Stack direction="row" align="center" gap={3}>
                    <Rocket className="w-6 h-6 text-primary" />
                    <Text variant="h2">Contests Served per Shard</Text>
                </Stack>

                <Text variant="small" color="text-muted-foreground">
                    From the service registry: the contest each bound shard serves. A registry row decides
                    what a running instance serves, so these rows — not one active id — are what is live.
                </Text>

                <ShardContestBindings
                    bindings={shardBindings}
                    contests={availableContests}
                    emptyText="No enabled registry row binds a shard to a contest."
                />

                <div className="p-4 bg-muted/20 border border-border rounded-xl">
                    <Stack direction="row" align="center" gap={3}>
                        <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Text variant="small" color="text-muted-foreground">
                            {activeContestId
                                ? `Deployment default (contests.is_active): #${activeContestId}${activeContestName ? ` — ${activeContestName}` : ''}. Applies only to an instance no registry row names.`
                                : 'No deployment default (contests.is_active) is set; an instance no registry row names serves no contest.'}
                        </Text>
                    </Stack>
                </div>
            </Stack>
        </Card>
    );
}
