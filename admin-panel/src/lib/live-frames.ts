import type { ServerStats } from '@/lib/server-stats';
import type { WorkerStat } from '@/lib/worker-stats';
import type { ContainerInfo, CoreServiceStatus, TrafficLog } from '@/lib/container-probes';
import type { ContainerRestartConfig } from '@/lib/container-restart-store';

// Why the section types are re-exported here: the panels read frames and nothing else, so one
// type-only import from this module keeps them away from the server modules that collect the data.
export type { ServerStats, WorkerStat, ContainerInfo, CoreServiceStatus, TrafficLog, ContainerRestartConfig };

/**
 * The frame contracts the live streams and the panels agree on.
 *
 * Why every section is optional: a section is left out when the viewer may not read it or when the
 * probe failed, and the panel keeps the value it already has. That is what stops a transient docker
 * failure from blanking a card that was showing the truth a second earlier.
 */
export interface ResourceFrame {
  server?: ServerStats;
  workers?: WorkerStat[];
  services?: CoreServiceStatus[];
  traffic?: TrafficLog[];
}

export interface ContainersFrame {
  containers?: ContainerInfo[];
  restartCounts?: Record<string, number>;
  config?: ContainerRestartConfig;
}

/**
 * A stable description of what a frame carries, for "send only when something changed".
 *
 * Why the traffic rows are reduced to their counters: the probe re-stamps every row with a fresh
 * timestamp and re-indexes it on every pass, so comparing whole rows would report a change five
 * times a minute while the numbers stood still.
 */
export function resourceFrameFingerprint(frame: ResourceFrame): string {
  return JSON.stringify([
    frame.server,
    frame.workers,
    frame.services,
    frame.traffic?.map((log) => [log.container, log.rx, log.tx]),
  ]);
}

export function containersFrameFingerprint(frame: ContainersFrame): string {
  return JSON.stringify([frame.containers, frame.restartCounts, frame.config]);
}
