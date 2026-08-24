'use client';

import { useState } from 'react';
import { restartServices, updateServer } from '@/app/actions/services';
import { pullLatestImages, rebuildImages } from '@/app/actions/docker-ops';
import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { RefreshCw, Download, Package, ArrowUpCircle } from 'lucide-react';

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

  const handleUpdate = async (): Promise<void> => {
    if (!confirm('This will pull the latest images, restart all services, and update the database schema. The server will be unavailable for a few minutes. Continue?')) return;
    setUpdating(true);
    try {
      const res = await updateServer();
      if (res.success) alert('✓ ' + res.message);
      else alert('Error: ' + res.error);
    } catch {
      alert('Failed to trigger update');
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

  const handleRestart = async (): Promise<void> => {
    if (!confirm(`Are you sure you want to ${label}? This will temporarily disrupt service.`)) return;
    setRestarting(true);
    try {
      const res = await restartServices(type);
      if (res.success) alert(res.message);
      else alert('Error: ' + res.error);
    } catch {
      alert('Failed to restart');
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

  const handlePull = async (): Promise<void> => {
    if (!confirm('Pull latest images from registry? This may take several minutes.')) return;
    setPulling(true);
    try {
      const res = await pullLatestImages();
      if (res.success) alert('✓ ' + res.message);
      else alert('Error: ' + res.error);
    } catch {
      alert('Failed to pull images');
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

  const handleRebuild = async (): Promise<void> => {
    if (!confirm(`Rebuild ${label} stack from source? This may take 5-10 minutes.`)) return;
    setRebuilding(true);
    try {
      const res = await rebuildImages(stack);
      if (res.success) alert('✓ ' + res.message);
      else alert('Error: ' + res.error);
    } catch {
      alert('Failed to rebuild');
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
