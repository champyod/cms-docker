import { Card } from '@/components/core/Card';
import { ContainerInfo } from '@/app/actions/docker';

interface SystemLogsPanelProps {
  containers: ContainerInfo[];
}

export function SystemLogsPanel({ containers }: SystemLogsPanelProps) {
    return (
        <Card className="p-6 glass-card border-white/5 space-y-4">
            <h3 className="font-bold text-white font-mono text-sm tracking-wider uppercase text-neutral-500">System Logs</h3>
            <div className="bg-black/40 rounded-xl p-4 h-40 font-mono text-xs overflow-y-auto text-neutral-400 border border-white/5">
                <div className="text-indigo-400">[SYSTEM] Docker Control initialized...</div>
                <div>[INFO] Monitoring {containers.length} containers</div>
                {containers.filter(c => c.state !== 'running').map(c => (
                    <div key={c.id} className="text-amber-500/80">[WARN] Container {c.name} is {c.state}</div>
                ))}
                <div className="mt-2 text-neutral-600">Waiting for events...</div>
            </div>
        </Card>
    );
}
