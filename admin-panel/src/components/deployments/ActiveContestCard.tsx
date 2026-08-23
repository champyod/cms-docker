'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
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
}

export function ActiveContestCard({
  activeContestId,
  activeContestName,
  availableContests,
  selectedContestId,
  deployPhase,
  hasChangedContest,
  onSelectContest,
  onActivate
}: ActiveContestCardProps) {
    return (
        <Card className="bg-white/2 p-6 border border-white/5">
            <Stack gap={5}>
                <Stack direction="row" align="center" gap={3}>
                    <Rocket className="w-6 h-6 text-indigo-400" />
                    <Text variant="h2">Current Active Contest</Text>
                </Stack>

                {activeContestId && (
                    <div className="flex items-center gap-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                        <div className="w-12 h-12 rounded-xl bg-indigo-600/20 flex items-center justify-center text-indigo-400 font-bold text-lg">
                            #{activeContestId}
                        </div>
                        <div>
                            <Text variant="h3" color="text-white">{activeContestName || `Contest #${activeContestId}`}</Text>
                            <Text variant="small" color="text-neutral-400">Currently deployed contest stack</Text>
                        </div>
                    </div>
                )}

                {!activeContestId && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <Stack direction="row" align="center" gap={3}>
                            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                            <div>
                                <Text variant="h3" color="text-amber-400">No Active Contest</Text>
                                <Text variant="small" color="text-neutral-400">Select a contest below and activate it.</Text>
                            </div>
                        </Stack>
                    </div>
                )}

                {/* Contest Selector */}
                <Stack gap={2} className="mt-6">
                    <Text variant="label" className="flex items-center gap-2">
                        <Rocket className="w-3 h-3" />
                        Select Contest to Deploy
                    </Text>
                    <Stack direction="row" align="center" gap={3}>
                        <select
                            value={selectedContestId ?? ''}
                            onChange={(e) => onSelectContest(e.target.value ? parseInt(e.target.value) : null)}
                            className="flex-1 bg-black/40 px-4 py-2.5 rounded-lg border border-white/10 text-white text-sm outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                        >
                            <option value="" className="bg-neutral-900">-- Select a contest --</option>
                            {availableContests.map((contest) => (
                                <option key={contest.id} value={contest.id} className="bg-neutral-900">
                                    #{contest.id} - {contest.name}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={onActivate}
                            disabled={deployPhase === 'deploying' || deployPhase === 'polling' || !hasChangedContest || !selectedContestId}
                            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-indigo-900/20 disabled:shadow-none"
                        >
                            {deployPhase === 'deploying' || deployPhase === 'polling' ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Rocket className="w-4 h-4" />
                            )}
                            {deployPhase === 'deploying' ? 'Starting...'
                                : deployPhase === 'polling' ? 'Deploying...'
                                : 'Activate & Restart Stack'}
                        </button>
                    </Stack>
                    <Text variant="small" color="text-neutral-500" className="mb-4">
                        This will update the env file, mark the contest as active in the database, and restart the contest stack.
                    </Text>
                </Stack>
            </Stack>
        </Card>
    );
}
