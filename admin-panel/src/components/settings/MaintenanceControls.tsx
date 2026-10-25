'use client';

import { useEffect, useState } from 'react';
import { getBoundContestId } from '@/app/actions/contests';
import { getDeploymentMode, restartServices, updateServer } from '@/app/actions/services';
import { pullLatestImages, rebuildImages } from '@/app/actions/docker-ops';
import { FALLBACK_DEPLOYMENT_MODE, deploymentModeCopyKey, type DeploymentModeSetting } from '@/lib/deployment-mode';
import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { Button } from '@/components/core/Button';
import { RefreshCw, Download, Package, ArrowUpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

type DeploymentModeRead = { loaded: false } | { loaded: true; setting: DeploymentModeSetting };

/**
 * Why the panel reads config.toml for this instead of process.env: only `./cms config sync` copies
 * the value into .env, so the environment can lag an edit made here, and the panel must describe the
 * mode the next restart will actually use. A failed call is reported as unresolved (the state the
 * server falls back on) rather than as a mode that was never read.
 */
function useDeploymentModeSetting(): DeploymentModeRead {
  const [read, setRead] = useState<DeploymentModeRead>({ loaded: false });

  useEffect(() => {
    void (async () => {
      const setting = await getDeploymentMode().catch((): DeploymentModeSetting => ({
        mode: FALLBACK_DEPLOYMENT_MODE,
        resolved: false,
      }));
      setRead({ loaded: true, setting });
    })();
  }, []);

  return read;
}

/**
 * States what a restart does in the deployment's own mode, because img (pull, no rebuild) and src
 * (rebuild) differ in cost and in what ends up running. Renders nothing until the read lands, so it
 * cannot claim a mode before it knows one.
 */
export function DeploymentModeNote(): ReactElement | null {
  const read = useDeploymentModeSetting();
  const copy = useDictionary().settings.deploymentMode;

  if (!read.loaded) return null;
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {copy[deploymentModeCopyKey(read.setting)]}
    </p>
  );
}

export function ManualServiceControlCard(): ReactElement {
  const copy = useDictionary();
  const toasts = copy.toasts.serviceControl;
  const bound = useBoundContest();
  const warning = bound.loaded ? restartWarning(bound.contestId, copy.settings.serviceControl) : null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Manual Service Control</h2>
          <p className="text-muted-foreground text-sm mt-1">Force restart services if needed.</p>
        </div>
      </div>
      {/* Why the warning stands on the card and not only in the dialog: the operator has to know the
          board is live before they pick a button, not after they have committed to one. */}
      {warning !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
        >
          {warning}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RestartButton type="core" label={copy.confirmations.restartStack.labels.core} warning={warning} />
        <RestartButton type="admin" label={copy.confirmations.restartStack.labels.admin} warning={warning} />
        <RestartButton type="worker" label={copy.confirmations.restartStack.labels.worker} warning={warning} />
        <RestartButton type="all" label={copy.confirmations.restartStack.labels.all} warning={warning} />
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        {toasts.contestManagedElsewhere}
      </p>
    </Card>
  );
}

/**
 * Whether the stack in front of the operator is serving a contest right now.
 *
 * Why 'unknown' is its own answer and not null: a failed read must never render as "no contest bound".
 * That would hide the one warning this card exists for exactly when the panel cannot see the truth.
 */
function useBoundContest(): { loaded: false } | { loaded: true; contestId: number | null | 'unknown' } {
  const [read, setRead] = useState<{ loaded: false } | { loaded: true; contestId: number | null | 'unknown' }>({
    loaded: false,
  });

  useEffect(() => {
    void (async () => {
      const result = await getBoundContestId().catch((): { success: false } => ({ success: false }));
      const contestId = result.success && result.binding !== undefined ? result.binding.contestId : 'unknown';
      setRead({ loaded: true, contestId });
    })();
  }, []);

  return read;
}

/** The sentence the card and the dialog both use, so the warning cannot drift between the two. */
function restartWarning(
  contestId: number | null | 'unknown',
  copy: Dictionary['settings']['serviceControl'],
): string | null {
  if (contestId === null) return null;
  if (contestId === 'unknown') return copy.contestLiveRestartUnknown;
  return interpolate(copy.contestLiveRestart, { contest: String(contestId) });
}

export function MaintenanceUpdatesCard(): ReactElement {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Maintenance & Updates</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage system updates and images.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">System Update</p>
          <UpdateServerButton />
          <PullImagesButton />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Restart Stacks (Use Pre-built Images)</p>
          <div className="grid grid-cols-2 gap-2">
            <RebuildButton stack="core" label="Core" />
            <RebuildButton stack="admin" label="Admin" />
            <RebuildButton stack="worker" label="Worker" />
            <RebuildButton stack="all" label="All" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function UpdateServerButton(): ReactElement {
  const [updating, setUpdating] = useState(false);
  const confirm = useConfirm();
  const { fullServerUpdateConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleUpdate = async (): Promise<void> => {
    if (!(await confirm(fullServerUpdateConfirm()))) return;
    setUpdating(true);
    try {
      const res = await updateServer();
      // The action's own message is server-side English; only the panel's fallbacks are localised here.
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.updateFailed);
    }
    setUpdating(false);
  };

  return (
    <Button
      onClick={() => void handleUpdate()}
      disabled={updating}
      loading={updating}
      icon={ArrowUpCircle}
      className="w-full justify-center"
    >
      {updating ? 'Updating Server...' : 'Full Server Update'}
    </Button>
  );
}

function RestartButton({
  type,
  label,
  warning,
}: {
  type: 'core' | 'admin' | 'worker' | 'all';
  label: string;
  warning: string | null;
}): ReactElement {
  const [restarting, setRestarting] = useState(false);
  const prompt = useReasonPrompt();
  const { restartStackConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleRestart = (): void => {
    const base = restartStackConfirm(type);
    // Why the reason is asked in the dialog that runs the action and not up front: a reason box on the
    // card would demand a justification before the operator has chosen what to justify.
    prompt.ask({
      title: base.title,
      description:
        warning === null ? `${base.description} ${toasts.restartReasonHint}` : `${base.description} ${toasts.restartReasonHint} ${warning}`,
      submitLabel: base.confirmLabel,
      run: async (reason) => {
        setRestarting(true);
        try {
          const res = await restartServices(type, undefined, reason);
          if (res.success) toast.success(res.message);
          else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
          return res;
        } catch {
          toast.error(toasts.restartFailed);
          return { success: false, error: toasts.restartFailed };
        } finally {
          setRestarting(false);
        }
      },
    });
  };

  return (
    <>
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
      <Button
        variant="positiveOutline"
        onClick={handleRestart}
        disabled={restarting}
        loading={restarting}
        icon={RefreshCw}
      >
        {restarting ? toasts.restarting : label}
      </Button>
    </>
  );
}

function PullImagesButton(): ReactElement {
  const [pulling, setPulling] = useState(false);
  const confirm = useConfirm();
  const { pullImagesConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handlePull = async (): Promise<void> => {
    if (!(await confirm(pullImagesConfirm()))) return;
    setPulling(true);
    try {
      const res = await pullLatestImages();
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.pullFailed);
    }
    setPulling(false);
  };

  return (
    <Button
      variant="secondary"
      onClick={() => void handlePull()}
      disabled={pulling}
      loading={pulling}
      icon={Download}
      className="w-full justify-center"
    >
      {pulling ? 'Pulling Images...' : 'Pull Latest Images'}
    </Button>
  );
}

function RebuildButton({ stack, label }: { stack: 'core' | 'admin' | 'worker' | 'all', label: string }): ReactElement {
  const [rebuilding, setRebuilding] = useState(false);
  const confirm = useConfirm();
  const { rebuildStackConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleRebuild = async (): Promise<void> => {
    if (!(await confirm(rebuildStackConfirm(stack)))) return;
    setRebuilding(true);
    try {
      const res = await rebuildImages(stack);
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.rebuildFailed);
    }
    setRebuilding(false);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void handleRebuild()}
      disabled={rebuilding}
      loading={rebuilding}
      icon={Package}
    >
      {rebuilding ? 'Building...' : label}
    </Button>
  );
}
