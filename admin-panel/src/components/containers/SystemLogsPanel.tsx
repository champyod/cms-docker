import { Card } from '@/components/core/Card';
import { ContainerInfo } from '@/app/actions/docker';

interface SystemLogsPanelProps {
  containers: ContainerInfo[];
}

export function SystemLogsPanel({ containers }: SystemLogsPanelProps) {
    return (
        <Card className="p-6 space-y-4">
            <h3 className="font-bold font-mono text-sm tracking-wider uppercase text-muted-foreground">System Logs</h3>
            <div className="bg-background/80 rounded-xl p-4 h-40 font-mono text-xs overflow-y-auto text-muted-foreground border border-border">
                <div className="text-primary">[SYSTEM] Docker Control initialized...</div>
                <div>[INFO] Monitoring {containers.length} containers</div>
                {containers.filter(c => c.state !== 'running').map(c => (
                    <div key={c.id} className="text-warning">[WARN] Container {c.name} is {c.state}</div>
                ))}
                <div className="mt-2 text-muted-foreground/60">Waiting for events...</div>
            </div>
        </Card>
    );
}
