'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Download, RefreshCw, Search } from 'lucide-react';

import { fetchContainerLogs, getContainerLogs, type ContainerLogResult } from '@/app/actions/docker';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { LogFollowButton } from '@/components/core/LogFollowButton';

interface LogViewerModalProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

interface ToolbarProperties {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  tail: number;
  onTailChange: (value: number) => void;
  onDownload: () => void;
  onRefresh: () => void;
  isLoading: boolean;
}

interface DisplayProperties {
  logs: string;
  searchTerm: string;
  isAutoScroll: boolean;
  onToggleAutoScroll: () => void;
  logReference: React.RefObject<HTMLPreElement | null>;
}

function filterLogsByTerm(logs: string, searchTerm: string): string {
  if (!searchTerm) return logs;
  const lower = searchTerm.toLowerCase();
  return logs
    .split('\n')
    .filter((line) => line.toLowerCase().includes(lower))
    .join('\n');
}

function downloadLogsToFile(logs: string, containerName: string): void {
  const blob = new Blob([logs], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${containerName}_logs.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function LogToolbar({
  searchTerm,
  onSearchChange,
  tail,
  onTailChange,
  onDownload,
  onRefresh,
  isLoading,
}: ToolbarProperties): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative mr-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter logs..."
          className="bg-background/80 border border-border rounded-lg pl-9 pr-3 py-2.5 sm:py-1.5 min-h-11 sm:min-h-0 text-xs text-foreground focus:outline-none focus:border-ring/60 w-48 transition-all"
        />
      </div>
      <select
        value={tail}
        onChange={(event) => onTailChange(Number(event.target.value))}
        className="bg-background/80 border border-border rounded-lg px-2 py-2.5 sm:py-1.5 min-h-11 sm:min-h-0 text-xs text-foreground focus:outline-none"
      >
        <option value={100}>Last 100</option>
        <option value={500}>Last 500</option>
        <option value={1000}>Last 1000</option>
      </select>
      <Button variant="secondary" size="sm" icon={Download} tooltip="Download Logs" onClick={onDownload} />
      <Button variant="secondary" size="sm" icon={RefreshCw} tooltip="Refresh Logs" onClick={onRefresh} disabled={isLoading} />
    </div>
  );
}

function LogDisplay({
  logs,
  searchTerm,
  isAutoScroll,
  onToggleAutoScroll,
  logReference,
}: DisplayProperties): React.JSX.Element {
  const filteredLogs = useMemo(() => filterLogsByTerm(logs, searchTerm), [logs, searchTerm]);
  const displayText = filteredLogs || (searchTerm ? 'No logs match filter.' : 'No logs available.');

  return (
    <div className="bg-background/80 p-4 relative flex flex-col max-h-[70vh] overflow-y-auto rounded-lg border border-border">
      <pre
        ref={logReference}
        className="flex-1 overflow-auto font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all custom-scrollbar"
      >
        {displayText}
      </pre>
      <LogFollowButton
        following={isAutoScroll}
        onClick={onToggleAutoScroll}
        className="absolute bottom-4 right-4"
      />
    </div>
  );
}

function useContainerLogs(containerId: string, tail: number): { logs: string; isLoading: boolean; refreshLogs: () => Promise<void> } {
  const [logs, setLogs] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const applyResult = useCallback((result: ContainerLogResult): void => {
    if (result.success) {
      setLogs(result.logs);
    } else {
      setLogs(`Error fetching logs: ${result.error}`);
    }
    setIsLoading(false);
  }, []);

  // Why the tick reads without auditing: it repeats every few seconds for as long as the viewer
  // is open, and a row per tick is hundreds an hour of a panel that is only being watched.
  const loadLatest = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    applyResult(await fetchContainerLogs(containerId, tail));
  }, [containerId, tail, applyResult]);

  // The button is a person asking for the output again, so that one is recorded.
  const refreshLogs = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    applyResult(await getContainerLogs(containerId, tail));
  }, [containerId, tail, applyResult]);

  useEffect(() => {
    queueMicrotask(() => void loadLatest());
    const interval = setInterval(() => {
      void loadLatest();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadLatest]);

  return { logs, isLoading, refreshLogs };
}

export function LogViewerModal({ containerId, containerName, onClose }: LogViewerModalProps): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [tail, setTail] = useState<number>(100);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(true);
  const logReference = useRef<HTMLPreElement>(null);
  const { logs, isLoading, refreshLogs } = useContainerLogs(containerId, tail);
  useEffect(() => {
    if (isAutoScroll && logReference.current) logReference.current.scrollTop = logReference.current.scrollHeight;
  }, [logs, isAutoScroll]);
  return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={containerName} description={`${containerId.slice(0, 12)}…`} className="max-w-4xl">
      <LogToolbar searchTerm={searchTerm} onSearchChange={setSearchTerm} tail={tail} onTailChange={setTail} onDownload={() => downloadLogsToFile(logs, containerName)} onRefresh={refreshLogs} isLoading={isLoading} />
      <LogDisplay logs={logs} searchTerm={searchTerm} isAutoScroll={isAutoScroll} onToggleAutoScroll={() => setIsAutoScroll(!isAutoScroll)} logReference={logReference} />
    </Dialog>
  );
}
