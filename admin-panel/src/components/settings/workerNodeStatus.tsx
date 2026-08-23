'use client';

import { Wifi, WifiOff, Activity } from 'lucide-react';
import type { ReactElement } from 'react';
import { WorkerConnectionState } from './workerNodesTypes';

export function getStatusIcon(status: WorkerConnectionState): ReactElement {
  switch (status) {
    case 'connected': return <Wifi className="w-4 h-4 text-emerald-400" />;
    case 'idle': return <Activity className="w-4 h-4 text-blue-400" />;
    case 'busy': return <Activity className="w-4 h-4 text-amber-400 animate-pulse" />;
    case 'disconnected': return <WifiOff className="w-4 h-4 text-red-400" />;
    default: return <WifiOff className="w-4 h-4 text-neutral-500" />;
  }
}

export function getStatusColor(status: WorkerConnectionState): string {
  switch (status) {
    case 'connected': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    case 'idle': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    case 'busy': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    case 'disconnected': return 'text-red-400 bg-red-400/10 border-red-400/20';
    default: return 'text-neutral-400 bg-neutral-400/10 border-neutral-400/20';
  }
}
