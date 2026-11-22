'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { InlineAlert } from '@/components/core/InlineAlert';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { ActiveContestCard } from '@/components/deployments/ActiveContestCard';
import { ContestSettingsForm } from '@/components/deployments/ContestSettingsForm';
import { DeployStatusPanel } from '@/components/deployments/DeployStatusPanel';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { WorkersPanel } from '@/components/deployments/WorkersPanel';
import { useContestDeploymentSnapshot } from '@/components/deployments/useContestDeploymentSnapshot';
import { useDeployWorkers } from '@/components/deployments/useDeployWorkers';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useDeployContest } from '@/hooks/useDeployContest';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

type Snapshot = ReturnType<typeof useContestDeploymentSnapshot>;
type Workers = ReturnType<typeof useDeployWorkers>;

interface DeploymentSurface {
  readonly snapshot: Snapshot;
  readonly workers: Workers;
  readonly saving: boolean;
  readonly deploy: ReturnType<typeof useDeployContest>;
}

const DeploymentsContext = createContext<DeploymentSurface | null>(null);

function useDeployment(): DeploymentSurface {
  const value = useContext(DeploymentsContext);
  if (value === null) {
    throw new Error('useDeployment must be used inside DeploymentsProvider');
  }
  return value;
}

/**
 * The one read of the deployment, shared by the three sections.
 *
 * WHY a provider: the active contest, the stack settings and the workers are three sections that read
 * the same eight sources and share one saving flag, and the board renders each in a section of its
 * own - so the read has to sit above the layout. Three sections each opening their own snapshot would
 * read config.toml three times and disagree about which read settled last.
 */
export function DeploymentsProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const dict = useDictionary();
  const deploy = useDeployContest();
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [workersSaving, setWorkersSaving] = useState(false);
  const snapshot = useContestDeploymentSnapshot({
    setSaving: setSettingsSaving,
    deployPhase: deploy.state.phase,
  });
  const workers = useDeployWorkers(setWorkersSaving);
  const { applyDeployedContestId, loadData } = snapshot;

  // Why the deploy spinner is derived, not mirrored into state: a state copy of the
  // deploy phase needs an effect to clear it, and that effect renders a second time
  // on every terminal phase. Reading the phase directly cannot go stale. The two
  // write paths keep their own flags because they are not the deploy.
  const deployInFlight = deploy.state.phase === 'deploying' || deploy.state.phase === 'polling';
  const saving = settingsSaving || workersSaving || deployInFlight;

  // Why every source is re-read at every terminal phase: the operation settles server side — activating
  // its contest, or rolling the configuration back — and can settle after this panel last read the
  // database. A value held from before that settle reports a mismatch the deploy has already resolved.
  // loadData is that read, and it takes every source in one pass: the database's active row, the
  // shard's registry binding, and the CONTEST_ID the stack was configured with.
  useEffect(() => {
    const ended = deploy.state.phase === 'completed' || deploy.state.phase === 'failed' || deploy.state.phase === 'timeout';
    if (!ended) return;
    // Why the id is applied before the read rather than after it: the card stays on the contest this
    // panel just deployed while the reads are in flight, and the read — not this line — is what the
    // values on screen come from once it answers. Only a completed deploy applies it: a failed one
    // leaves config.toml on whatever its rollback restored, and the read is what says so.
    if (deploy.state.phase === 'completed' && deploy.state.contestId !== null) {
      applyDeployedContestId(deploy.state.contestId);
    }
    void loadData({ silent: true });
  }, [deploy.state.phase, deploy.state.contestId, applyDeployedContestId, loadData]);

  // Why the refresh is withdrawn while loading: the panel body is the loading surface during
  // that read, and loadData is the read it would restart underneath itself.
  usePublishModuleActions(
    'infrastructure.deployments',
    snapshot.status.kind === 'idle' ? (
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void loadData()}>
        {dict.deployments.refresh}
      </Button>
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
    <DeploymentsContext.Provider value={{ snapshot, workers, saving, deploy }}>
      {children}
    </DeploymentsContext.Provider>
  );
}

/**
 * What is wrong with the deployment right now: a read that failed, a deploy in flight, or a stack
 * whose three records disagree about which contest it runs.
 *
 * WHY this is the board's state and not a section: it is read before the three sections, and it is
 * about all of them - the mismatch is between the database, the container and the registry.
 */
export function DeploymentState(): React.JSX.Element {
  const { snapshot, deploy } = useDeployment();
  const dict = useDictionary();
  return (
    <>
      {snapshot.failedReads.length > 0 && (
        <InlineAlert tone="warning" announce="polite" title={dict.deployments.partialTitle}>
          {interpolate(dict.deployments.partialDescription, {
            parts: snapshot.failedReads.map((failure) => failure.label).join(', '),
          })}
        </InlineAlert>
      )}
      {deploy.state.phase !== 'idle' && (
        <DeployStatusPanel state={deploy.state} onCancel={deploy.cancel} onReset={deploy.reset} />
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
    </>
  );
}

/** Which contest the stack runs. The board frames this section and names it. */
export function ActiveContestSection(): React.JSX.Element {
  const { snapshot } = useDeployment();
  return (
    <ActiveContestCard
      shardBindings={snapshot.shardBindings}
      activeContestId={snapshot.activeContestId}
      activeContestName={snapshot.activeContestName}
      availableContests={snapshot.availableContests}
    />
  );
}

/** The config.toml values the contest stack reads on its next start. */
export function StackSettingsSection(): React.JSX.Element {
  const { snapshot } = useDeployment();
  return (
    <ContestSettingsForm
      globalSettings={snapshot.globalSettings}
      onGlobalChange={(key, value) => snapshot.setGlobalSettings((previous) => ({ ...previous, [key]: value }))}
    />
  );
}

/**
 * The settings section's action: it appears once a field differs from what was read, so the header
 * never offers a save that would write the same values back.
 */
export function StackSettingsSave(): React.JSX.Element | null {
  const { snapshot, saving } = useDeployment();
  if (!snapshot.isDirty) return null;
  return (
    <Button onClick={() => void snapshot.saveSettings()} disabled={saving} size="sm">
      <Save className="w-3 h-3 mr-1.5" />
      Save Settings
    </Button>
  );
}

/** The worker containers the fleet runs, and whether the monitor can still reach them. */
export function WorkersSection(): React.JSX.Element {
  const { workers, saving } = useDeployment();
  return (
    <WorkersPanel
      workers={workers.workers}
      status={workers.liveWorkers}
      freshness={workers.freshness}
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
  );
}
