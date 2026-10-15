'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/core/Badge';
import { StatusPill } from '@/components/core/StatusPill';
import type { WorkerNodeListRow } from '@/lib/worker-nodes';

interface WorkerNodeRowProps {
  index: number;
  row: WorkerNodeListRow;
  canManage: boolean;
  onRemove?: (key: string) => void;
  onEdit?: (key: string, field: 'host' | 'port', value: string) => void;
}

const INPUT_CLASS =
  'bg-background/80 border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground font-mono outline-none focus:border-ring/60';

function workerLabel(row: WorkerNodeListRow): string {
  return row.host || row.key;
}

function EndpointField({ row, canManage, onEdit }: WorkerNodeRowProps): ReactElement {
  if (!canManage || !onEdit) {
    return <span className="font-mono text-sm text-foreground truncate">{row.host}:{row.port}</span>;
  }
  return (
    <>
      <input
        value={row.host}
        onChange={(event) => onEdit(row.key, 'host', event.target.value)}
        placeholder="Host (e.g., cms-worker-0)"
        aria-label={`Host for worker ${workerLabel(row)}`}
        className={`flex-1 min-w-0 ${INPUT_CLASS}`}
      />
      <input
        value={row.port}
        onChange={(event) => onEdit(row.key, 'port', event.target.value)}
        type="number"
        placeholder="26000"
        aria-label={`Port for worker ${workerLabel(row)}`}
        className={`w-20 ${INPUT_CLASS}`}
      />
    </>
  );
}

export function WorkerNodeRow(props: WorkerNodeRowProps): ReactElement {
  const { index, row, canManage, onRemove } = props;
  const live = row.live;
  const [expanded, setExpanded] = useState(false);
  // Why: a row the live stream names but the configuration does not carry has no entry for
  // Remove or Edit to act on, so both would look functional and write nothing.
  const editable = canManage && row.configured;

  return (
    <div data-shortcut-row className="bg-muted/30 p-3 rounded-lg border border-border">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-6 h-6 shrink-0 rounded-md bg-background/60 flex items-center justify-center text-xs font-bold text-muted-foreground">
          {index + 1}
        </span>

        <EndpointField {...props} canManage={editable} />

        <StatusPill status={live?.connection ?? 'unknown'} />
        {live?.shard != null && <Badge variant="info">{`shard ${live.shard}`}</Badge>}
        {live?.contest != null && <Badge variant="neutral">{`contest ${live.contest}`}</Badge>}
        {live?.lagging && <Badge variant="destructive">{`${live.tasks} queued`}</Badge>}

        {editable && onRemove && (
          <button
            onClick={() => onRemove(row.key)}
            aria-label={`Remove worker ${row.host}`}
            className="ml-auto flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {live && (
        <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span>state: {live.state}</span>
          {live.health !== 'none' && <span>health: {live.health}</span>}
          <span className="inline-flex items-center gap-1">
            {live.reachable ? <Wifi className="w-3 h-3 text-success" /> : <WifiOff className="w-3 h-3" />}
            {live.reachable ? 'reachable' : 'unreachable'}
          </span>
          <span>{live.tasks} open task{live.tasks === 1 ? '' : 's'}</span>
          {live.uptime && <span>up {live.uptime}</span>}
          {live.restarts > 0 && <span className="text-warning">restarts: {live.restarts}</span>}
          {live.lastLog && (
            <button
              onClick={() => setExpanded((value) => !value)}
              aria-label="Toggle worker log"
              className="ml-auto inline-flex items-center gap-1 text-info hover:text-info/80"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              log
            </button>
          )}
        </div>
      )}

      {!live && (
        <div className="mt-1.5 text-xs text-muted-foreground">No telemetry yet — is this worker deployed?</div>
      )}

      {expanded && live?.lastLog && (
        <pre className="mt-1 p-2 bg-background/80 rounded text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
          {live.lastLog}
        </pre>
      )}
    </div>
  );
}
