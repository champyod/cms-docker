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
    // The settings group above owns the title and the frame; this is the one fact it cannot know.
    return (
      <p className="text-sm text-muted-foreground">
        Monitor enhancement disabled (set MONITOR_ENHANCED=1 in .env).
      </p>
    );
  }

  const targets = await prisma.monitor_targets.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const serialized: MonitorTarget[] = targets.map((t: (typeof targets)[number]) => ({
    ...t,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return <MonitorConfigSectionClient initialTargets={serialized} />;
}
