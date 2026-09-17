'use client';

import { useState } from 'react';
import { restartServices, updateServer } from '@/app/actions/services';
import { pullLatestImages, rebuildImages } from '@/app/actions/docker-ops';
import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { RefreshCw, Download, Package, ArrowUpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

export function ManualServiceControlCard(): ReactElement {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Manual Service Control</h2>
          <p className="text-muted-foreground text-sm mt-1">Force restart services if needed.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RestartButton type="core" label="Core Stack" />
        <RestartButton type="admin" label="Admin Stack" />
        <RestartButton type="worker" label="Worker Stack" />
        <RestartButton type="all" label="All Services" />
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Note: Contest instances are managed in <strong>Infrastructure → Deployments</strong> page.
      </p>
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

function RestartButton({ type, label }: { type: 'core' | 'admin' | 'worker' | 'all', label: string }): ReactElement {
  const [restarting, setRestarting] = useState(false);
  const confirm = useConfirm();
  const { restartStackConfirm } = useConfirmationCopy();
  const toasts = useDictionary().toasts.serviceControl;

  const handleRestart = async (): Promise<void> => {
    if (!(await confirm(restartStackConfirm(type)))) return;
    setRestarting(true);
    try {
      const res = await restartServices(type);
      if (res.success) toast.success(res.message);
      else toast.error(interpolate(toasts.actionFailed, { error: res.error }));
    } catch {
      toast.error(toasts.restartFailed);
    }
    setRestarting(false);
  };

  return (
    <Button
      variant="positiveOutline"
      onClick={() => void handleRestart()}
      disabled={restarting}
      loading={restarting}
      icon={RefreshCw}
    >
      {restarting ? 'Restarting...' : label}
    </Button>
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
