'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/core/Button';
import { 
  X, RefreshCw, Terminal, Download, 
  ChevronDown, ChevronUp, Search
} from 'lucide-react';
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
  const [mounted, setMounted] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [containerId, tail]);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

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

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ touchAction: 'none' }}>
      {/* Full screen backdrop - prevents interaction with background */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={(e) => { e.stopPropagation(); }}
        style={{ touchAction: 'none' }}
      />

      {/* Modal content */}
      <div className="relative z-10 w-full max-w-4xl h-[80vh] flex flex-col glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/10">
        {/* Header */}
        <div className="p-4 border-b border-white/5 bg-white/[0.03] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white leading-none">{containerName}</h2>
              <p className="text-[10px] text-neutral-500 font-mono mt-1 opacity-60">{containerId}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="relative mr-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
              <input 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Filter logs..."
                className="bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-48 transition-all"
              />
            </div>
            
            <select 
              value={tail} 
              onChange={e => setTail(Number(e.target.value))}
              className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
            >
              <option value={100}>Last 100</option>
              <option value={500}>Last 500</option>
              <option value={1000}>Last 1000</option>
            </select>

            <Button variant="secondary" size="sm" onClick={downloadLogs} className="p-2">
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={fetchLogs} className="p-2" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="p-2 hover:bg-red-500/10 hover:text-red-400">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Log Area */}
        <div className="flex-1 bg-black/80 p-4 relative overflow-hidden flex flex-col">
          <pre 
            ref={logRef}
            className="flex-1 overflow-auto font-mono text-xs text-neutral-300 whitespace-pre-wrap break-all custom-scrollbar"
          >
            {filteredLogs || (searchTerm ? 'No logs match filter.' : 'No logs available.')}
          </pre>
          
          <button 
            onClick={() => setAutoScroll(!autoScroll)}
            className={`absolute bottom-6 right-8 px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${
              autoScroll 
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30' 
                : 'bg-black/80 border-white/10 text-neutral-400 hover:text-white'
            }`}
          >
            {autoScroll ? 'AUTO-SCROLL ON' : 'AUTO-SCROLL OFF'}
          </button>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/5 bg-black/40 flex justify-between items-center px-6">
          <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">
            Live Streaming Updates • Every 5s
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-[10px] text-indigo-400 font-bold">MONITORING ACTIVE</span>
             </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
