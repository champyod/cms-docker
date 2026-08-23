'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/providers/ToastProvider';
import { useDeployContest } from '@/hooks/useDeployContest';

export function useContestListActions() {
  const { addToast } = useToast();
  const { state: deployState, deploy: handleDeploy, reset: resetDeployState } = useDeployContest();
  const [deployTarget, setDeployTarget] = useState<number | null>(null);

  const requestDeploy = (id: number) => setDeployTarget(id);
  const confirmDeploy = () => { if (deployTarget !== null) handleDeploy(deployTarget); };
  const closeDeploy = () => { setDeployTarget(null); resetDeployState(); };

  useEffect(() => {
    if (deployState.phase === 'completed') {
      addToast({ type: 'success', title: 'Contest Deployed', message: `Contest #${deployState.contestId} is now active.` });
      setDeployTarget(null); resetDeployState(); window.location.reload();
    } else if (deployState.phase === 'failed' || deployState.phase === 'timeout') {
      addToast({ type: 'error', title: 'Deploy Failed', message: deployState.error || 'Deploy did not complete.' });
      setDeployTarget(null); resetDeployState();
    } else if (deployState.phase === 'already_running') {
      addToast({ type: 'warning', title: 'Deploy Already Running', message: deployState.error || 'Another deploy is in progress.' });
      setDeployTarget(null); resetDeployState();
    }
  }, [deployState.phase, deployState.contestId, deployState.error, addToast, resetDeployState]);

  return { deployState, deployTarget, requestDeploy, confirmDeploy, closeDeploy };
}
