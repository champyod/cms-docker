'use client';

import { Card } from '@/components/core/Card';
import { StackActionButton } from '@/components/containers/StackActionButton';
import { SystemLogsPanel } from '@/components/containers/SystemLogsPanel';
import type { ContainerInfo } from '@/app/actions/docker';

interface ContainerStackControlsProps {
  containers: ContainerInfo[];
  actionLoading: string | null;
  onCompose: (action: 'up' | 'down' | 'restart' | 'build', serviceType?: 'core' | 'admin' | 'contest' | 'worker') => void;
}

export function ContainerStackControls({ containers, actionLoading, onCompose }: ContainerStackControlsProps): React.JSX.Element {
  const isLoading = actionLoading === 'compose';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="p-6 space-y-4">
        <h3 className="font-bold text-foreground">Stack Controls</h3>
        <p className="text-sm text-muted-foreground">Manage complete service groups via Docker Compose.</p>
        <div className="grid grid-cols-2 gap-3">
          <StackActionButton label="All Services" onRestart={() => onCompose('restart')} onUp={() => onCompose('up')} onBuild={() => onCompose('build')} isLoading={isLoading} />
          <StackActionButton label="Core Stack" onRestart={() => onCompose('restart', 'core')} onUp={() => onCompose('up', 'core')} onBuild={() => onCompose('build', 'core')} isLoading={isLoading} />
          <StackActionButton label="Admin Stack" onRestart={() => onCompose('restart', 'admin')} onUp={() => onCompose('up', 'admin')} onBuild={() => onCompose('build', 'admin')} isLoading={isLoading} />
          <StackActionButton label="Worker Stack" onRestart={() => onCompose('restart', 'worker')} onUp={() => onCompose('up', 'worker')} onBuild={() => onCompose('build', 'worker')} isLoading={isLoading} />
        </div>
      </Card>
      <SystemLogsPanel containers={containers} />
    </div>
  );
}
