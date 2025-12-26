import { getDictionary } from '@/i18n';
import { WorkerGrid } from '@/components/resources/WorkerGrid';
import { Activity, Server, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/core/Card';

export default async function ResourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Resource Control
        </h1>
        <p className="text-neutral-400">
          Monitor and manage distributed worker nodes and core services.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-6 glass-card border-white/5 bg-gradient-to-br from-neutral-900/80 to-indigo-950/20">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-white">Core Status</h2>
            </div>
            <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-400">Database</span>
                    <span className="text-emerald-400 font-medium">HEALTHY</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-400">Log Service</span>
                    <span className="text-emerald-400 font-medium">RUNNING</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-400">Evaluation Service</span>
                    <span className="text-emerald-400 font-medium">IDLE</span>
                </div>
            </div>
          </Card>

          <Card className="p-6 glass-card border-white/5 flex flex-col justify-center items-center text-center space-y-2">
            <div className="text-3xl font-bold text-white">94%</div>
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Global Uptime</div>
            <div className="w-full h-1 bg-white/5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: '94%' }} />
            </div>
          </Card>

           <Card className="p-6 glass-card border-white/5 flex flex-col justify-center items-center text-center space-y-2">
            <div className="text-3xl font-bold text-white">12.4ms</div>
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Avg. Latency</div>
            <div className="w-full h-1 bg-white/5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-cyan-500" style={{ width: '30%' }} />
            </div>
          </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-white">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h2 className="text-xl font-bold">Worker Nodes</h2>
        </div>
        <WorkerGrid />
      </div>
    </div>
  );
}
