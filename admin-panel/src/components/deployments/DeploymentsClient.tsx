'use client';

import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

import { useDeployContest } from '@/hooks/useDeployContest';
import { Stack } from '@/components/core/Layout';
import { Button } from '@/components/core/Button';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { DeployStatusPanel } from '@/components/deployments/DeployStatusPanel';
import { ActiveContestCard } from '@/components/deployments/ActiveContestCard';
import { ContestSettingsForm } from '@/components/deployments/ContestSettingsForm';
import { WorkersPanel } from '@/components/deployments/WorkersPanel';
import { useDeployWorkers } from '@/components/deployments/useDeployWorkers';
import { useContestDeploymentSnapshot } from '@/components/deployments/useContestDeploymentSnapshot';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

export function DeploymentsClient(): React.JSX.Element {
  const dict = useDictionary();
  const { state: deployState, deploy: handleDeploy, cancel: cancelDeploy, reset: resetDeploy } = useDeployContest();
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [workersSaving, setWorkersSaving] = useState(false);
  const snapshot = useContestDeploymentSnapshot({
    setSaving: setSettingsSaving,
    deployPhase: deployState.phase,
  });
  const workers = useDeployWorkers(setWorkersSaving);
  const { applyDeployedContestId, loadData } = snapshot;

  // Why the deploy spinner is derived, not mirrored into state: a state copy of the
  // deploy phase needs an effect to clear it, and that effect renders a second time
  // on every terminal phase. Reading the phase directly cannot go stale. The two
  // write paths keep their own flags because they are not the deploy.
  const deployInFlight = deployState.phase === 'deploying' || deployState.phase === 'polling';
  const saving = settingsSaving || workersSaving || deployInFlight;

  // Why every source is re-read at every terminal phase: the operation settles server side — activating
  // its contest, or rolling the configuration back — and can settle after this panel last read the
  // database. A value held from before that settle reports a mismatch the deploy has already resolved.
  // loadData is that read, and it takes every source in one pass: the database's active row, the
  // shard's registry binding, and the CONTEST_ID the stack was configured with.
  useEffect(() => {
    const ended = deployState.phase === 'completed' || deployState.phase === 'failed' || deployState.phase === 'timeout';
    if (!ended) return;
    // Why the id is applied before the read rather than after it: the card stays on the contest this
    // panel just deployed while the reads are in flight, and the read — not this line — is what the
    // values on screen come from once it answers. Only a completed deploy applies it: a failed one
    // leaves config.toml on whatever its rollback restored, and the read is what says so.
    if (deployState.phase === 'completed' && deployState.contestId !== null) {
      applyDeployedContestId(deployState.contestId);
    }
    void loadData({ silent: true });
  }, [deployState.phase, deployState.contestId, applyDeployedContestId, loadData]);

  const handleActivateAndRestart = (): void => {
    if (snapshot.selectedContestId === null || !snapshot.hasChangedContest) return;
    handleDeploy(snapshot.selectedContestId);
  };

  // Why the refresh is withdrawn while loading: the panel body is the loading surface during
  // that read, and loadData is the read it would restart underneath itself.
  usePublishModuleActions(
    'infrastructure.deployments',
    snapshot.status.kind === 'idle' ? (
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => void loadData()}
        >
          {dict.deployments.refresh}
        </Button>
      </div>
    ) : null,
  );

  if (snapshot.status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={snapshot.status}
        loadingTitle={dict.states.loading.deployments}
        onRetry={() => void loadData()}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  return (
    <Stack gap={8} className="pb-20">
      {snapshot.failedReads.length > 0 && (
        <InlineAlert tone="warning" announce="polite" title={dict.deployments.partialTitle}>
          {interpolate(dict.deployments.partialDescription, {
            parts: snapshot.failedReads.map((failure) => failure.label).join(', '),
          })}
        </InlineAlert>
      )}

      {deployState.phase !== 'idle' && (
        <DeployStatusPanel state={deployState} onCancel={cancelDeploy} onReset={resetDeploy} />
      )}

      {snapshot.hasMismatch && (
        <MismatchBanner
          activeContestId={snapshot.activeContestId}
          activeContestName={snapshot.activeContestName}
          dbActiveContestId={snapshot.dbActiveContestId}
          containerContestId={snapshot.containerContestId}
          boundContestId={snapshot.boundContestId}
          boundContestSource={snapshot.boundContestSource}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <Stack gap={6} className="xl:col-span-2">
          <ActiveContestCard
            shardBindings={snapshot.shardBindings}
            activeContestId={snapshot.activeContestId}
            activeContestName={snapshot.activeContestName}
            availableContests={snapshot.availableContests}
            selectedContestId={snapshot.selectedContestId}
            deployPhase={deployState.phase}
            hasChangedContest={snapshot.hasChangedContest}
            onSelectContest={snapshot.setSelectedContestId}
            onActivate={handleActivateAndRestart}
            onCancel={cancelDeploy}
          />
          <ContestSettingsForm
            globalSettings={snapshot.globalSettings}
            saving={saving}
            isDirty={snapshot.isDirty}
            onGlobalChange={(key, value) => snapshot.setGlobalSettings((previous) => ({ ...previous, [key]: value }))}
            onSaveSettings={() => void snapshot.saveSettings()}
          />
        </Stack>
        <WorkersPanel
          workers={workers.workers}
          status={workers.liveWorkers}
          forbidden={workers.workersForbidden}
          error={workers.workersError}
          canManage={workers.canManageWorkers}
          saving={saving}
          workersDirty={workers.workersDirty}
          onSaveWorkers={workers.handleSaveWorkers}
          onAddWorker={workers.addGlobalWorker}
          onRemoveWorker={workers.removeGlobalWorker}
          onUpdateWorker={workers.updateGlobalWorker}
        />
      </div>
    </Stack>
  );
}
