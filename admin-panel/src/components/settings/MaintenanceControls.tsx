'use client';

import { useState } from 'react';
import { restartServices, updateServer } from '@/app/actions/services';
import { pullLatestImages, rebuildImages } from '@/app/actions/docker-ops';
import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { RefreshCw, Download, Package, ArrowUpCircle } from 'lucide-react';

export function ManualServiceControlCard(): ReactElement {
  return (
    <Card className="glass-card border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Manual Service Control</h2>
          <p className="text-neutral-400 text-sm mt-1">Force restart services if needed.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RestartButton type="core" label="Core Stack" />
        <RestartButton type="admin" label="Admin Stack" />
        <RestartButton type="worker" label="Worker Stack" />
        <RestartButton type="all" label="All Services" />
      </div>
      <p className="text-xs text-neutral-500 mt-4">
        Note: Contest instances are managed in <strong>Infrastructure → Deployments</strong> page.
      </p>
    </Card>
  );
}

export function MaintenanceUpdatesCard(): ReactElement {
  return (
    <Card className="glass-card border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Maintenance & Updates</h2>
          <p className="text-neutral-400 text-sm mt-1">Manage system updates and images.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider">System Update</p>
          <UpdateServerButton />
          <PullImagesButton />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Restart Stacks (Use Pre-built Images)</p>
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
    <button
      onClick={() => void handleUpdate()}
      disabled={updating}
      className="flex items-center gap-2 px-4 py-3 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/30 transition-colors disabled:opacity-50 w-full justify-center"
    >
      <ArrowUpCircle className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
      {updating ? 'Updating Server...' : 'Full Server Update'}
    </button>
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
    <button
      onClick={() => void handleRestart()}
      disabled={restarting}
      className="flex items-center gap-2 px-4 py-2 bg-amber-600/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-600/30 transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${restarting ? 'animate-spin' : ''}`} />
      {restarting ? 'Restarting...' : label}
    </button>
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
    <button
      onClick={() => void handlePull()}
      disabled={pulling}
      className="flex items-center gap-2 px-4 py-3 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors disabled:opacity-50 w-full justify-center"
    >
      <Download className={`w-4 h-4 ${pulling ? 'animate-bounce' : ''}`} />
      {pulling ? 'Pulling Images...' : 'Pull Latest Images'}
    </button>
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
    <button
      onClick={() => void handleRebuild()}
      disabled={rebuilding}
      className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50 text-sm"
    >
      <Package className={`w-3 h-3 ${rebuilding ? 'animate-spin' : ''}`} />
      {rebuilding ? 'Building...' : label}
    </button>
  );
}
