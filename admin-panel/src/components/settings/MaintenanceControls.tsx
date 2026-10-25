'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, Download, Package } from 'lucide-react';
import { toast } from 'sonner';
import { pullLatestImages, rebuildImages } from '@/app/actions/docker-ops';
import { getDeploymentMode, updateServer } from '@/app/actions/services';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { RestartControls } from '@/components/settings/RestartControls';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { FALLBACK_DEPLOYMENT_MODE, deploymentModeCopyKey, type DeploymentModeSetting } from '@/lib/deployment-mode';
import { interpolate } from '@/lib/interpolate';

type DeploymentModeRead = { loaded: false } | { loaded: true; setting: DeploymentModeSetting };

// Reads config.toml rather than process.env: only `./cms config sync` copies the value into .env.
function useDeploymentModeSetting(): DeploymentModeRead {
  const [read, setRead] = useState<DeploymentModeRead>({ loaded: false });

  useEffect(() => {
    void (async (): Promise<void> => {
      const setting = await getDeploymentMode().catch((): DeploymentModeSetting => ({
        mode: FALLBACK_DEPLOYMENT_MODE,
        resolved: false,
      }));
      setRead({ loaded: true, setting });
    })();
  }, []);

  return read;
}

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

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Manual Service Control</h2>
          <p className="text-muted-foreground text-sm mt-1">Force restart services if needed.</p>
        </div>
      </div>
      <RestartControls />
      <p className="text-xs text-muted-foreground mt-4">{copy.settings.serviceControl.contestManagedElsewhere}</p>
    </Card>
  );
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
  const [isUpdating, setIsUpdating] = useState(false);
  const confirm = useConfirm();
  const { fullServerUpdateConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleUpdate = async (): Promise<void> => {
    if (!(await confirm(fullServerUpdateConfirm()))) return;
    setIsUpdating(true);
    try {
      const res = await updateServer();
      // The action's own message is server-side English; only the panel's fallbacks are localised here.
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.updateFailed);
    }
    setIsUpdating(false);
  };

  return (
    <Button
      onClick={() => void handleUpdate()}
      disabled={isUpdating}
      loading={isUpdating}
      icon={ArrowUpCircle}
      className="w-full justify-center"
    >
      {isUpdating ? 'Updating Server...' : 'Full Server Update'}
    </Button>
  );
}

function PullImagesButton(): ReactElement {
  const [isPulling, setIsPulling] = useState(false);
  const confirm = useConfirm();
  const { pullImagesConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handlePull = async (): Promise<void> => {
    if (!(await confirm(pullImagesConfirm()))) return;
    setIsPulling(true);
    try {
      const res = await pullLatestImages();
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.pullFailed);
    }
    setIsPulling(false);
  };

  return (
    <Button
      variant="secondary"
      onClick={() => void handlePull()}
      disabled={isPulling}
      loading={isPulling}
      icon={Download}
      className="w-full justify-center"
    >
      {isPulling ? 'Pulling Images...' : 'Pull Latest Images'}
    </Button>
  );
}

function RebuildButton({ stack, label }: { stack: 'core' | 'admin' | 'worker' | 'all'; label: string }): ReactElement {
  const [isRebuilding, setIsRebuilding] = useState(false);
  const confirm = useConfirm();
  const { rebuildStackConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleRebuild = async (): Promise<void> => {
    if (!(await confirm(rebuildStackConfirm(stack)))) return;
    setIsRebuilding(true);
    try {
      const res = await rebuildImages(stack);
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.rebuildFailed);
    }
    setIsRebuilding(false);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void handleRebuild()}
      disabled={isRebuilding}
      loading={isRebuilding}
      icon={Package}
    >
      {isRebuilding ? 'Building...' : label}
    </Button>
  );
}
