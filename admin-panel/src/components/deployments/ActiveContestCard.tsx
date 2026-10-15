'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Button } from '@/components/core/Button';
import { Rocket, RefreshCw, AlertTriangle } from 'lucide-react';
import type { DeployPhase } from '@/hooks/useDeployContest';
import type { ShardContestBinding } from '@/lib/service-wiring-contract';
import { ShardContestBindings } from '@/components/deployments/ShardContestBindings';

export interface ContestOption {
  id: number;
  name: string;
  is_active: boolean;
}

interface ActiveContestCardProps {
  /** The registry rows that bind a shard to a contest: the card's primary content, per shard. */
  shardBindings: readonly ShardContestBinding[];
  activeContestId: number | null;
  activeContestName: string | null;
  availableContests: ContestOption[];
  selectedContestId: number | null;
  deployPhase: DeployPhase;
  hasChangedContest: boolean;
  onSelectContest: (id: number | null) => void;
  onActivate: () => void;
  onCancel: () => void;
}

export function ActiveContestCard({
  shardBindings,
  activeContestId,
  activeContestName,
  availableContests,
  selectedContestId,
  deployPhase,
  hasChangedContest,
  onSelectContest,
  onActivate,
  onCancel
}: ActiveContestCardProps) {
  const isDeploying = deployPhase === 'deploying' || deployPhase === 'polling';
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
                <Stack gap={2} className="mt-6">
                    <Text variant="label" className="flex items-center gap-2">
                        <Rocket className="w-3 h-3" />
                        Select Contest to Deploy
                    </Text>
                    <Stack direction="row" align="center" gap={3} wrap>
                        <select
                            value={selectedContestId ?? ''}
                            onChange={(e) => onSelectContest(e.target.value ? parseInt(e.target.value) : null)}
                            disabled={isDeploying}
                            className="flex-1 bg-background/80 px-4 py-2.5 rounded-lg border border-border text-foreground text-sm outline-none focus:border-ring/60 appearance-none cursor-pointer disabled:opacity-50"
                        >
                            <option value="" className="bg-card">-- Select a contest --</option>
                            {availableContests.map((contest) => (
                                <option key={contest.id} value={contest.id} className="bg-card">
                                    #{contest.id} - {contest.name}
                                </option>
                            ))}
                        </select>
                        {!isDeploying ? (
                            <Button
                                onClick={onActivate}
                                disabled={!hasChangedContest || !selectedContestId}
                                icon={Rocket}
                            >
                                Activate &amp; Restart Stack
                            </Button>
                        ) : (
                            <>
                                <Button
                                    disabled
                                    loading
                                    icon={RefreshCw}
                                >
                                    {deployPhase === 'deploying' ? 'Starting...' : 'Deploying...'}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={onCancel}
                                >
                                    Cancel
                                </Button>
                            </>
                        )}
                    </Stack>
                    <Text variant="small" color="text-muted-foreground" className="mb-4">
                        This will mark the contest as active in the database, run the config sync, and restart the contest stack.
                    </Text>
                </Stack>
            </Stack>
        </Card>
    );
}
