'use client';

import { Wifi, WifiOff, Activity } from 'lucide-react';
import type { ReactElement } from 'react';
import { WorkerConnectionState } from './workerNodesTypes';

export function getStatusIcon(status: WorkerConnectionState): ReactElement {
  switch (status) {
    case 'connected': return <Wifi className="w-4 h-4 text-success" />;
    case 'idle': return <Activity className="w-4 h-4 text-info" />;
    case 'busy': return <Activity className="w-4 h-4 text-warning animate-pulse" />;
    case 'disconnected': return <WifiOff className="w-4 h-4 text-destructive" />;
    default: return <WifiOff className="w-4 h-4 text-muted-foreground" />;
  }
}

export function getStatusColor(status: WorkerConnectionState): string {
  switch (status) {
    case 'connected': return 'text-success bg-success/10 border-success/20';
    case 'idle': return 'text-info bg-info/10 border-info/20';
    case 'busy': return 'text-warning bg-warning/10 border-warning/20';
    case 'disconnected': return 'text-destructive bg-destructive/10 border-destructive/20';
    default: return 'text-muted-foreground bg-muted/40 border-border';
  }
}
