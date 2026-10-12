'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { readActiveContestId, readConfigTomlValues, updateConfigTomlValues } from '@/app/actions/configTomlActions';
import { activateContest, getAvailableContests } from '@/app/actions/contests';
import { settleDeployOperations, getActiveDeployOperation } from '@/app/actions/deployActions';
import { getContainerContestId } from '@/app/actions/docker';
import { buildConfigTomlUpdates } from '@/lib/config-toml';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import type { DeployPhase } from '@/hooks/useDeployContest';
import { CONTEST_SETTINGS_KEYS } from '@/components/deployments/deploymentConfig';
import type { ContestOption } from '@/components/deployments/ActiveContestCard';
import type { Dispatch, SetStateAction } from 'react';

export interface ContestDeploymentSnapshot {
  readonly status: SurfaceStatus;
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

  const applyContestSnapshot = useCallback((settings: Record<string, string>, activeId: number | null): number | null => {
    // Both the active id and the settings below come from config.toml, the file
    // `./cms config sync` regenerates .env from — the id from [contest] CONTEST_ID,
    // the settings from the same section.
    setActiveContestId(activeId);
    setSelectedContestId(activeId);
    setGlobalSettings(settings);
    setOriginalGlobal(JSON.stringify(settings));
    return activeId;
  }, []);

  const readSnapshot = useCallback(async (): Promise<void> => {
    // Why the settle comes before the reads: a deploy that finished while nothing watched its
    // operation still owes its activation (or its rollback), and the values read below are only
    // the truth about the stack once that has run.
    try {
      await settleDeployOperations();
    } catch {
      // A settle that could not run leaves what it owes on the operation's own record, which the
      // next visit retries. Failing the screen instead would hide the deploy state the operator
      // came to read.
    }
    const [activeResult, settingsResult, contestsResult, containerResult] = await Promise.all([
      readActiveContestId(),
      readConfigTomlValues(CONTEST_SETTINGS_KEYS),
      getAvailableContests(),
      getContainerContestId(),
      // Why the audited read: this screen exists to answer "what is deployed right now", and
      // asking whether a deploy is in flight is part of that answer, so the ask is recorded.
      // The 30s discovery poll stays on the unaudited core — this runs on a visit, on the
      // refresh button, and once per terminal deploy phase, never on a timer.
      getActiveDeployOperation(),
    ]);

    // Read the freshly parsed id, not the state binding — setState in this same tick leaves the
    // closure stale.
    const stackId = containerResult.success ? containerResult.contestId : null;
    setContainerContestId(stackId);

    const databaseContests = contestsResult.success ? contestsResult.contests : [];
    setAvailableContests(databaseContests);

    // The running stack is the single source of truth for "which contest is live", so the card
    // shows its contest and falls back to config.toml's CONTEST_ID only when the stack did not
    // answer. config.toml and the DB are derived from it, never the other way round.
    const configId = activeResult.success ? activeResult.contestId : null;
    const actualActiveId = applyContestSnapshot(
      settingsResult.success ? settingsResult.values : {},
      stackId ?? configId,
    );

    const dbActive = databaseContests.find(
      (contest: { id: number; name: string; is_active: boolean }) => contest.is_active === true,
    );
    setDbActiveContestId(dbActive ? dbActive.id : null);

    // Derive contests.is_active from the stack. It is the column's only meaningful writer, so a
    // stack switch made outside the panel converges here. Best-effort: an operator without
    // contest:switch leaves the column for a later writer, while the card still shows the truth.
    if (stackId !== null && stackId !== (dbActive ? dbActive.id : null)) {
      try {
        await activateContest(stackId);
      } catch {
        // Left for a writer that holds contest:switch.
      }
    }

    if (actualActiveId !== null) {
      const match = databaseContests.find(
        (contest: { id: number; name: string; is_active: boolean }) => contest.id === actualActiveId,
      );
      if (match) setActiveContestName(match.name);
    }
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
