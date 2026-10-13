'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { readActiveContestId, readConfigTomlValues, updateConfigTomlValues } from '@/app/actions/configTomlActions';
import { getAvailableContests } from '@/app/actions/contests';
import { settleDeployOperations, getActiveDeployOperation } from '@/app/actions/deployActions';
import { getContainerContestId } from '@/app/actions/docker';
import { buildConfigTomlUpdates } from '@/lib/config-toml';
import { readFailures, settleRead, type ReadFailure } from '@/lib/settled-read';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import type { DeployPhase } from '@/hooks/useDeployContest';
import { CONTEST_SETTINGS_KEYS } from '@/components/deployments/deploymentConfig';
import type { ContestOption } from '@/components/deployments/ActiveContestCard';
import type { Dispatch, SetStateAction } from 'react';

/** The name each read carries into the "parts that failed" notice. */
const READ_LABELS = {
  settle: 'deploy settle',
  activeContest: 'active contest',
  settings: 'contest settings',
  contests: 'contest list',
  container: 'running container',
  operation: 'deploy operation',
} as const;

export interface ContestDeploymentSnapshot {
  readonly status: SurfaceStatus;
  readonly failedReads: readonly ReadFailure[];
  readonly availableContests: ContestOption[];
  readonly activeContestId: number | null;
  readonly activeContestName: string | null;
  readonly dbActiveContestId: number | null;
  readonly containerContestId: number | null;
  readonly selectedContestId: number | null;
  readonly globalSettings: Record<string, string>;
  readonly isDirty: boolean;
  readonly hasChangedContest: boolean;
  readonly hasMismatch: boolean;
  readonly setSelectedContestId: Dispatch<SetStateAction<number | null>>;
  readonly setGlobalSettings: Dispatch<SetStateAction<Record<string, string>>>;
  readonly applyDeployedContestId: (contestId: number) => void;
  readonly loadData: (options?: { silent?: boolean }) => Promise<void>;
  readonly saveSettings: () => Promise<void>;
}

export interface ContestDeploymentSnapshotOptions {
  readonly setSaving: Dispatch<SetStateAction<boolean>>;
  readonly deployPhase: DeployPhase;
}

export function useContestDeploymentSnapshot({
  setSaving,
  deployPhase,
}: ContestDeploymentSnapshotOptions): ContestDeploymentSnapshot {
  const dict = useDictionary();
  const toastCopy = dict.toasts.deploySettings;
  const [availableContests, setAvailableContests] = useState<ContestOption[]>([]);
  const [activeContestId, setActiveContestId] = useState<number | null>(null);
  const [activeContestName, setActiveContestName] = useState<string | null>(null);
  const [dbActiveContestId, setDbActiveContestId] = useState<number | null>(null);
  const [containerContestId, setContainerContestId] = useState<number | null>(null);
  const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
  const [originalGlobal, setOriginalGlobal] = useState<string>('{}');
  const [failedReads, setFailedReads] = useState<readonly ReadFailure[]>([]);

  const applyContestSnapshot = useCallback((settings: Record<string, string>, activeId: number | null): number | null => {
    // The settings come from config.toml; the active id comes from the database
    // (contests.is_active), which config.toml and .env are derived from.
    setActiveContestId(activeId);
    setSelectedContestId(activeId);
    setGlobalSettings(settings);
    setOriginalGlobal(JSON.stringify(settings));
    return activeId;
  }, []);

  const readSnapshot = useCallback(async (): Promise<void> => {
    // The settle runs first: a deploy that finished unwatched still owes its activation.
    const settle = await settleRead(READ_LABELS.settle, settleDeployOperations);
    const [active, settings, contests, container, operation] = await Promise.all([
      settleRead(READ_LABELS.activeContest, readActiveContestId),
      settleRead(READ_LABELS.settings, () => readConfigTomlValues(CONTEST_SETTINGS_KEYS)),
      settleRead(READ_LABELS.contests, getAvailableContests),
      settleRead(READ_LABELS.container, getContainerContestId),
      // Why the audited read: this screen exists to answer "what is deployed right now", and
      // asking whether a deploy is in flight is part of that answer, so the ask is recorded.
      // The 30s discovery poll stays on the unaudited core — this runs on a visit, on the
      // refresh button, and once per terminal deploy phase, never on a timer.
      settleRead(READ_LABELS.operation, getActiveDeployOperation),
    ]);

    // Read the freshly parsed value, not the state binding — setState in this same tick leaves the
    // closure stale.
    const stackId = container.value?.success ? container.value.contestId : null;
    setContainerContestId(stackId);

    const databaseContests = contests.value?.success ? contests.value.contests : [];
    setAvailableContests(databaseContests);

    // The database is the single source of truth for the active contest; config.toml, .env
    // and the container environment are the same value projected outward. The id the card
    // shows is therefore the database's, falling back to the container only while the
    // database read failed — and nothing here writes the database back from the container,
    // which would let a stack that has not been recreated revert a newer active contest.
    const dbId = active.value?.success ? active.value.contestId : null;
    const actualActiveId = applyContestSnapshot(
      settings.value?.success ? settings.value.values : {},
      dbId ?? stackId,
    );

    const dbActive = databaseContests.find(
      (contest: { id: number; name: string; is_active: boolean }) => contest.is_active === true,
    );
    setDbActiveContestId(dbActive ? dbActive.id : null);

    if (actualActiveId !== null) {
      const match = databaseContests.find(
        (contest: { id: number; name: string; is_active: boolean }) => contest.id === actualActiveId,
      );
      if (match) setActiveContestName(match.name);
    }

    setFailedReads(readFailures([settle, active, settings, contests, container, operation]));
  }, [applyContestSnapshot]);

  const { status, reload } = useSurfaceLoad(readSnapshot, surfaceLoadMessages(dict));

  const loadData = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (options?.silent !== true) {
      reload();
      return;
    }
    // Why the background re-read must not blank the panel: it runs when a deploy settles, and the
    // operator is reading the result of that deploy. A failure is not hidden either — it falls
    // back to the full load, which reports it through the surface status.
    try {
      await readSnapshot();
    } catch {
      reload();
    }
  }, [readSnapshot, reload]);

  const applyDeployedContestId = useCallback((contestId: number): void => {
    setActiveContestId(contestId);
  }, []);

  const saveSettings = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await updateConfigTomlValues(buildConfigTomlUpdates(globalSettings, CONTEST_SETTINGS_KEYS));
      if (!result.success) {
        toast.error(toastCopy.saveFailedTitle, { description: result.error || toastCopy.saveFailedFallback });
        return;
      }
      setOriginalGlobal(JSON.stringify(globalSettings));
      toast.success(toastCopy.savedTitle, { description: toastCopy.savedDescription });
    } catch (error) {
      toast.error(toastCopy.unexpectedErrorTitle, { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }, [globalSettings, setSaving, toastCopy]);

  const isDirty = JSON.stringify(globalSettings) !== originalGlobal;
  const hasChangedContest = selectedContestId !== null && selectedContestId !== activeContestId;
  // Why a deploy in flight suppresses the banner: a running deploy or poll is about to
  // rewrite these three ids, so reporting the gap it is closing would alarm the operator.
  const hasMismatch = !deployPhase.startsWith('deploy') && !deployPhase.startsWith('poll')
    && activeContestId !== null && dbActiveContestId !== null
    && (activeContestId !== dbActiveContestId
      || (containerContestId !== null && (activeContestId !== containerContestId || dbActiveContestId !== containerContestId)));

  return {
    status,
    failedReads,
    availableContests,
    activeContestId,
    activeContestName,
    dbActiveContestId,
    containerContestId,
    selectedContestId,
    globalSettings,
    isDirty,
    hasChangedContest,
    hasMismatch,
    setSelectedContestId,
    setGlobalSettings,
    applyDeployedContestId,
    loadData,
    saveSettings,
  };
}
