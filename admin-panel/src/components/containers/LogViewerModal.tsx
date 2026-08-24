'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { RefreshCw, Terminal, Download, Search } from 'lucide-react';
import { getContainerLogs } from '@/app/actions/docker';

interface LogViewerModalProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

export function LogViewerModal({ containerId, containerName, onClose }: LogViewerModalProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [tail, setTail] = useState(100);
  const logRef = useRef<HTMLPreElement>(null);

  const fetchLogs = async () => {
    setLoading(true);
    const res = await getContainerLogs(containerId, tail);
    if (res.success) {
      setLogs(res.logs || 'No logs found.');
    } else {
      setLogs(`Error fetching logs: ${res.error}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-load or modal-reset pattern; behavior must not change
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [containerId, tail]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${containerName}_logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.split('\n').filter(line =>
    line.toLowerCase().includes(searchTerm.toLowerCase())
  ).join('\n');

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={containerName}
      description={containerId}
      className="max-w-4xl"
      footer={
        <div className="flex justify-between items-center w-full">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
            Live Streaming Updates • Every 5s
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-success font-bold">MONITORING ACTIVE</span>
          </div>
        </div>
      }
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative mr-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Filter logs..."
            className="bg-background/80 border border-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring/60 w-48 transition-all"
          />
        </div>

        <select
          value={tail}
          onChange={e => setTail(Number(e.target.value))}
          className="bg-background/80 border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none"
        >
          <option value={100}>Last 100</option>
          <option value={500}>Last 500</option>
          <option value={1000}>Last 1000</option>
        </select>

        <Button variant="secondary" size="sm" icon={Download} tooltip="Download Logs" onClick={downloadLogs} />
        <Button variant="secondary" size="sm" icon={RefreshCw} tooltip="Refresh Logs" onClick={fetchLogs} disabled={loading} />
      </div>

      {/* Log Area */}
      <div className="bg-background/80 p-4 relative overflow-hidden flex flex-col h-[60vh] rounded-lg border border-border">
        <pre
          ref={logRef}
          className="flex-1 overflow-auto font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all custom-scrollbar"
        >
          {filteredLogs || (searchTerm ? 'No logs match filter.' : 'No logs available.')}
        </pre>

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`absolute bottom-6 right-8 px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${
            autoScroll
              ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/30'
              : 'bg-background/80 border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {autoScroll ? 'AUTO-SCROLL ON' : 'AUTO-SCROLL OFF'}
        </button>
      </div>
    </Dialog>
  );
}
