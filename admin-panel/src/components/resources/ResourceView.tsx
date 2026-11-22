'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { WorkerNodeList } from '@/components/workers/WorkerNodeList';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';
import { GaugeCard } from '@/components/resources/GaugeCard';
import { Cpu, Database } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { RowFreshness } from '@/components/core/RowFreshness';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useLiveReadInstants } from '@/lib/live/use-live-reads';
import { sectionReadAt } from '@/lib/live/frames';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import { useDictionary } from '@/hooks/useDictionary';
import { TRAFFIC_LOG_LIMIT_DEFAULT } from '@/lib/constants/live-stream';
import type { LiveSectionReads } from '@/lib/live/frames';
import type { RowFreshnessInput } from '@/lib/live/row-freshness';
import type {
  ResourceFrame,
  ResourceSection,
  ServerStats,
  TrafficLog,
  WorkerNodeView,
  CoreServiceStatus,
} from '@/lib/live-frames';
import type { Dictionary } from '@/lib/dictionary';
import { rowsFromNodes } from '@/lib/worker-nodes';

/**
 * The sections whose values carry the cue: all four, because each one is read on a track of its own
 * and can therefore fall behind the page on its own.
 *
 * Why the counters are no longer the exception: the CPU/RAM gauges and the metrics card are single
 * figures rather than rows, and the cue reaches a figure the same way — it wraps the card, which is
 * why the gauge is handed a class, so it keeps filling the cell it used to stretch as.
 */
const CUED_SECTIONS: readonly ResourceSection[] = ['server', 'workers', 'services', 'traffic'];

interface PendingFirstFrame {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Why null and not a word: the label says where the numbers came from, which is itself a claim. */
function sourceLabel(serverStats: ServerStats | null, dict: Dictionary): string | null {
  if (serverStats === null) return null;
  return serverStats.source === 'host' ? dict.resources.hostSource : dict.resources.containerSource;
}

// Why the network figures get their own label: their origin can differ from the CPU/RAM/uptime one when only one mount is present.
function networkSourceLabel(serverStats: ServerStats | null, dict: Dictionary): string | null {
  const network = serverStats?.network;
  if (!network) return null;
  return network.source === 'host' ? dict.resources.hostSource : dict.resources.containerSource;
}

interface ResourceSurface {
  readonly serverStats: ServerStats | null;
  readonly workers: WorkerNodeView[];
  readonly workersError: string | null;
  readonly services: CoreServiceStatus[] | null;
  readonly traffic: TrafficLog[] | null;
  readonly trafficLimit: number;
  readonly setTrafficLimit: (limit: number) => void;
  readonly freshness: (section: ResourceSection) => RowFreshnessInput;
}

const ResourcesContext = createContext<ResourceSurface | null>(null);

function useResources(): ResourceSurface {
  const value = useContext(ResourcesContext);
  if (value === null) {
    throw new Error('useResources must be used inside ResourcesProvider');
  }
  return value;
}

/**
 * One stream, one read record, five sections.
 *
 * WHY a provider: the five sections arrive on one connection and each carries its own read instant,
 * so the section that falls behind is marked where the reader is looking. The board renders each
 * section in a slot of its own, so the stream has to sit above the layout - five sections each
 * opening their own channel would be five connections and five ideas of what is current.
 */
export function ResourcesProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const dict = useDictionary();
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [workers, setWorkers] = useState<WorkerNodeView[]>([]);
  // Why the fault is held apart from the rows: an unreadable fleet config arrives as an error beside
  // an empty list, and rendering that list would report a read fault as "no worker nodes found".
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [services, setServices] = useState<CoreServiceStatus[] | null>(null);
  const [traffic, setTraffic] = useState<TrafficLog[] | null>(null);
  const [trafficLimit, setTrafficLimit] = useState<number>(TRAFFIC_LOG_LIMIT_DEFAULT);

  // Why every section is optional in the frame: a section is left out when this viewer may not read
  // it or when its probe failed, and the card must then keep the last reading it had rather than
  // blanking out. The same handler covers all four cards because they arrive on one connection.
  const applyFrame = useCallback((frame: ResourceFrame): void => {
    if (frame.server) setServerStats(frame.server);
    if (frame.workers) {
      setWorkers(frame.workers);
      // Why the fault is replaced, not merged: it travels with the workers section, so a frame whose
      // fleet read succeeded carries no error and must clear the one the last frame reported.
      setWorkersError(frame.error ?? null);
    }
    if (frame.services) setServices(frame.services);
    if (frame.traffic) setTraffic(frame.traffic);
  }, []);

  // Why the first frame is the load: a channel that never carries one has loaded nothing, and its
  // status is what tells the panel body apart from a spinner that would never clear. The connection's
  // own state still lives in useLiveStream; this is only whether the load ever finished.
  const pendingFirstFrame = useRef<PendingFirstFrame | null>(null);
  const load = useCallback((): Promise<void> => new Promise<void>((resolve, reject) => {
    pendingFirstFrame.current = { resolve, reject };
  }), []);
  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  // Which read produced each section's value, and the newest read that has covered it: the two facts
  // the cue compares. One record for the whole page, because a section is one read — every row of the
  // workers, the services and the traffic shares its section's instant, and so does every figure the
  // counters section draws.
  const reads = useLiveReadInstants<ResourceSection>();

  const onFrame = useCallback((frame: ResourceFrame, readAt: string, sectionReads?: LiveSectionReads): void => {
    // The read a frame states for a section: its own where the frame carried it forward, the frame's
    // where the pass that produced the frame read it. The value and the coverage take that one instant,
    // so a section the frame did not re-read is never dated by a read that never touched it — while a
    // section whose own pass ran without refilling it does move forward, because then the frame states
    // the frame's read and the older value still behind it is exactly what the cue has to mark.
    for (const section of CUED_SECTIONS) reads.cover(section, sectionReadAt(readAt, sectionReads, section));
    if (frame.server) reads.record('server', sectionReadAt(readAt, sectionReads, 'server'));
    if (frame.workers) reads.record('workers', sectionReadAt(readAt, sectionReads, 'workers'));
    if (frame.services) reads.record('services', sectionReadAt(readAt, sectionReads, 'services'));
    if (frame.traffic) reads.record('traffic', sectionReadAt(readAt, sectionReads, 'traffic'));
    applyFrame(frame);
    pendingFirstFrame.current?.resolve();
    pendingFirstFrame.current = null;
  }, [applyFrame, reads]);

  const onStreamError = useCallback((): void => {
    pendingFirstFrame.current?.reject(new Error('The resource stream did not open'));
    pendingFirstFrame.current = null;
  }, []);

  // Why the stream's own status travels to the sections instead of to a badge: the panel's live
  // indicator was removed on purpose, and a section the panel can no longer confirm is where that has
  // to be visible. A channel that never delivers a first frame still fails the load below.
  const { status: streamStatus, refresh } = useLiveStream<ResourceFrame>({
    url: `/api/resources/stream?trafficLimit=${trafficLimit}`,
    onFrame,
    onError: onStreamError,
  });

  // The cue's input per section, ready-made from the read that produced its value and the newest read
  // that covered it. Nothing here guesses: a section no read has dated reports `unknown`, never fresh.
  const freshness = (section: ResourceSection): RowFreshnessInput => ({
    readAt: reads.reads[section],
    surfaceReadAt: reads.surfaces[section],
    streamStatus,
  });

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle={dict.resources.loading}
        onRetry={() => { reload(); refresh(); }}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  return (
    <ResourcesContext.Provider
      value={{ serverStats, workers, workersError, services, traffic, trafficLimit, setTrafficLimit, freshness }}
    >
      {children}
    </ResourcesContext.Provider>
  );
}

/** The services that answer for this deployment, and whether each is up. */
export function CoreServicesSection(): React.JSX.Element {
  const { services, freshness } = useResources();
  // Why "not here yet" is not "nothing to read": the summary section arrives later.
  return <CoreServicesStatus services={services ?? []} loading={services === null} freshness={freshness('services')} />;
}

/**
 * CPU and memory, as the two figures they are.
 *
 * WHY each gauge is wrapped in its own cue: the two are the `server` section's values, so the cue
 * wraps each figure rather than the pair.
 */
export function CountersSection(): React.JSX.Element {
  const { serverStats, freshness } = useResources();
  const dict = useDictionary();
  const source = sourceLabel(serverStats, dict);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <RowFreshness {...freshness('server')}>
        <GaugeCard
          className="h-full"
          icon={<Cpu className="h-4 w-4 text-primary" />}
          label={dict.resources.cpuUsage}
          source={source}
          percent={serverStats?.cpu || 0}
          tone="auto"
        />
      </RowFreshness>
      <RowFreshness {...freshness('server')}>
        <GaugeCard
          className="h-full"
          icon={<Database className="h-4 w-4 text-info" />}
          label={dict.resources.memoryUsage}
          source={source}
          percent={serverStats?.memory || 0}
          tone="info"
        />
      </RowFreshness>
    </div>
  );
}

/** The worker fleet as the monitor reports it, or the reason it could not be read. */
export function ResourceWorkersSection(): React.JSX.Element {
  const { workers, workersError, freshness } = useResources();
  if (workersError !== null) {
    return (
      <InlineAlert tone="destructive" announce="polite" title="Worker configuration unreadable">
        {workersError}
      </InlineAlert>
    );
  }
  return (
    <WorkerNodeList
      rows={rowsFromNodes(workers)}
      freshness={freshness('workers')}
      emptyTitle="No worker nodes found"
      emptyDescription="Workers are globally shared and configured in Infrastructure → Deployments"
    />
  );
}

/** Uptime, load average and network totals: the `server` section's counters. */
export function MetricsSection(): React.JSX.Element {
  const { serverStats, freshness } = useResources();
  return (
    <RowFreshness {...freshness('server')}>
      <MetricsCard serverStats={serverStats} />
    </RowFreshness>
  );
}

/** The newest traffic lines the proxy logged, and how many of them to keep on screen. */
export function TrafficSection(): React.JSX.Element {
  const { traffic, trafficLimit, setTrafficLimit, freshness } = useResources();
  return (
    <NetworkTrafficLogs
      logs={traffic ?? []}
      limit={trafficLimit}
      onLimitChange={setTrafficLimit}
      loading={traffic === null}
      freshness={freshness('traffic')}
    />
  );
}

export function MetricsCard({ serverStats }: { serverStats: ServerStats | null }): React.JSX.Element {
  const dict = useDictionary();
  const networkSource = networkSourceLabel(serverStats, dict);
  return (
    <div className="grid grid-cols-1 gap-6">
      <Card className="p-4 density:p-3">
        <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{dict.resources.uptime}</div>
            <div className="font-mono text-lg text-foreground">{serverStats?.uptime || '-'}</div>
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{dict.resources.loadAvg}</div>
            <div className="font-mono text-lg text-foreground">{serverStats?.loadAvg?.[0] || '-'}</div>
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              {dict.resources.networkTotal}{networkSource === null ? '' : ` ${networkSource}`}
            </div>
            <div className="font-mono text-xs text-success">
              {serverStats?.network ? `↓ ${formatBytes(serverStats.network.rx)}` : '-'}
            </div>
            <div className="font-mono text-xs text-primary">
              {serverStats?.network ? `↑ ${formatBytes(serverStats.network.tx)}` : '-'}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
