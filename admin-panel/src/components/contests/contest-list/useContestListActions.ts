'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDeployContest } from '@/hooks/useDeployContest';

export function useContestListActions() {
  const router = useRouter();
  const { state: deployState, deploy: handleDeploy, reset: resetDeployState } = useDeployContest();
  const [deployTarget, setDeployTarget] = useState<number | null>(null);

  const requestDeploy = (id: number): void => {
    if (deployState.phase !== 'deploying' && deployState.phase !== 'polling') resetDeployState();
    setDeployTarget(id);
  };
  const confirmDeploy = () => { if (deployTarget !== null) handleDeploy(deployTarget); };
  const closeDeploy = () => { setDeployTarget(null); resetDeployState(); };

  useEffect(() => {
    // Keep the shared result available to other pages; the provider publishes global toasts.
    if (deployState.phase === 'completed') router.refresh();
    if (['completed', 'failed', 'timeout', 'already_running'].includes(deployState.phase)) {
      queueMicrotask((): void => setDeployTarget(null));
    }
  }, [deployState.phase, router]);

  return { deployState, deployTarget, requestDeploy, confirmDeploy, closeDeploy };
}
