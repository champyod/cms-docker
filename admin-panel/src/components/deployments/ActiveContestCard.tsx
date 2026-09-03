'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Button } from '@/components/core/Button';
import { Rocket, RefreshCw, AlertTriangle } from 'lucide-react';
import type { DeployPhase } from '@/hooks/useDeployContest';

export interface ContestOption {
  id: number;
  name: string;
  is_active: boolean;
}

interface ActiveContestCardProps {
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
                    <Text variant="h2">Current Active Contest</Text>
                </Stack>

                {activeContestId && (
                    <div className="flex items-center gap-4 p-4 bg-primary/10 border border-primary/20 rounded-xl">
                        <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-bold text-lg">
                            #{activeContestId}
                        </div>
                        <div>
                            <Text variant="h3" color="text-foreground">{activeContestName || `Contest #${activeContestId}`}</Text>
                            <Text variant="small" color="text-muted-foreground">Currently deployed contest stack</Text>
                        </div>
                    </div>
                )}

                {!activeContestId && (
                    <div className="p-4 bg-warning/10 border border-warning/20 rounded-xl">
                        <Stack direction="row" align="center" gap={3}>
                            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
                            <div>
                                <Text variant="h3" color="text-warning">No Active Contest</Text>
                                <Text variant="small" color="text-muted-foreground">Select a contest below and activate it.</Text>
                            </div>
                        </Stack>
                    </div>
                )}
                <Stack gap={2} className="mt-6">
                    <Text variant="label" className="flex items-center gap-2">
                        <Rocket className="w-3 h-3" />
                        Select Contest to Deploy
                    </Text>
                    <Stack direction="row" align="center" gap={3}>
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
                        This will update the env file, mark the contest as active in the database, and restart the contest stack.
                    </Text>
                </Stack>
            </Stack>
        </Card>
    );
}
