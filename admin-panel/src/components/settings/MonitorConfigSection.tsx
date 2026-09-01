import { prisma } from '@/lib/prisma';
import { MonitorConfigSectionClient } from './MonitorConfigSectionClient';

type MonitorTarget = {
  id: string;
  url: string;
  interval: number;
  timeout: number;
  expectedStatus: number;
  alertDiscord: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function MonitorConfigSection(): Promise<React.ReactElement> {
  const enhanced = process.env.MONITOR_ENHANCED === '1';

  if (!enhanced) {
    return (
      <div className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Monitor Configuration</h2>
        <p className="text-neutral-400 text-sm">
          Monitor enhancement disabled (set MONITOR_ENHANCED=1 in .env.infra).
        </p>
      </div>
    );
  }

  const targets = await prisma.monitor_targets.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const serialized: MonitorTarget[] = targets.map((t) => ({
    ...t,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return <MonitorConfigSectionClient initialTargets={serialized} />;
}
