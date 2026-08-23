'use client';

import { Card } from '@/components/core/Card';
import { Zap } from 'lucide-react';

interface ContestTiming { start: string | Date | null; stop: string | Date | null; analysis_start: string | Date | null; analysis_stop: string | Date | null; }

interface FormTiming { start: string; stop: string; analysis_start: string; analysis_stop: string; }

function StatusBadge({ contest }: { contest: ContestTiming }) {
  const now = new Date();
  const start = contest.start ? new Date(contest.start) : null;
  const stop = contest.stop ? new Date(contest.stop) : null;
  const analysisStart = contest.analysis_start ? new Date(contest.analysis_start) : null;
  const analysisStop = contest.analysis_stop ? new Date(contest.analysis_stop) : null;
  if (!start || now < start) return <span className="px-3 py-1 bg-neutral-600/30 text-neutral-400 rounded-full text-sm">Not Started</span>;
  if (stop && now < stop) return <span className="px-3 py-1 bg-emerald-600/30 text-emerald-400 rounded-full text-sm animate-pulse">Running</span>;
  if (analysisStart && analysisStop && now >= analysisStart && now < analysisStop) return <span className="px-3 py-1 bg-purple-600/30 text-purple-400 rounded-full text-sm">Analysis Mode</span>;
  return <span className="px-3 py-1 bg-red-600/30 text-red-400 rounded-full text-sm">Ended</span>;
}

interface Props { contest: ContestTiming; formData: FormTiming; onChange: (patch: Partial<FormTiming>) => void; }

export function ContestStatusCard({ contest, formData, onChange }: Props) {
  return (
    <Card className="p-4 glass-card border-white/5">
      <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-3"><Zap className="w-5 h-5 text-amber-400" /><span className="font-bold text-white">Contest Status</span></div><div className="flex items-center gap-2"><StatusBadge contest={contest} /></div></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Contest Start</label><input type="datetime-local" value={formData.start} onChange={(e) => onChange({ start: e.target.value })} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Contest Stop</label><input type="datetime-local" value={formData.stop} onChange={(e) => onChange({ stop: e.target.value })} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Analysis Start</label><input type="datetime-local" value={formData.analysis_start} onChange={(e) => onChange({ analysis_start: e.target.value })} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Analysis Stop</label><input type="datetime-local" value={formData.analysis_stop} onChange={(e) => onChange({ analysis_stop: e.target.value })} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
      </div>
    </Card>
  );
}
