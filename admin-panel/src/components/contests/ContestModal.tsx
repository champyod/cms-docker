'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { X, Loader2 } from 'lucide-react';
import { createContest, updateContest } from '@/app/actions/contests';
import { contests } from '@prisma/client';

interface ContestModalProps {
  isOpen: boolean;
  onClose: () => void;
  contest?: contests | null;
  onSuccess: () => void;
}

const formatDateForInput = (date: Date | string | undefined) => {
    if (!date) return '';
    const d = new Date(date);
    // Adjust to local timezone ISO string for input[type="datetime-local"]
    // format: YYYY-MM-DDTHH:mm
    const pad = (n: number) => n < 10 ? '0' + n : n;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ContestModal({ isOpen, onClose, contest, onSuccess }: ContestModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start: '',
    stop: '',
    timezone: 'Asia/Bangkok',
  });

  useEffect(() => {
    if (contest) {
      setFormData({
        name: contest.name,
        description: contest.description,
        start: formatDateForInput(contest.start),
        stop: formatDateForInput(contest.stop),
        timezone: contest.timezone || 'Asia/Bangkok',
      });
    } else {
        // Default start: Now, Stop: Now + 5 hours
        const now = new Date();
        const end = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      setFormData({
        name: '',
        description: '',
        start: formatDateForInput(now),
        stop: formatDateForInput(end),
        timezone: 'Asia/Bangkok',
      });
    }
  }, [contest, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let result;
      const payload = {
        name: formData.name,
        description: formData.description,
        start: formData.start,
        stop: formData.stop,
        timezone: formData.timezone,
      };

      if (contest) {
        result = await updateContest(contest.id, payload);
      } else {
        result = await createContest(payload);
      }

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || 'Operation failed');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <Card className="w-full max-w-lg p-8 relative animate-in fade-in zoom-in-95 duration-200 glass-card border-white/10 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-8 tracking-tight">
          {contest ? 'Edit Contest' : 'Create New Contest'}
        </h2>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Contest Name</label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-sans placeholder:text-neutral-700 shadow-inner"
              placeholder="IOI 2025 Selection Round 1"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Description</label>
            <textarea
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all h-28 resize-none font-sans placeholder:text-neutral-700 shadow-inner"
              placeholder="Detailed description of the contest..."
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Start Time</label>
                <input
                    required
                    type="datetime-local"
                    value={formData.start}
                    onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all [color-scheme:dark] shadow-inner"
                />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Stop Time</label>
                <input
                    required
                    type="datetime-local"
                    value={formData.stop}
                    onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
                className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all [color-scheme:dark] shadow-inner"
                />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Timezone</label>
            <input
              required
              type="text"
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono placeholder:text-neutral-700 shadow-inner"
              placeholder="Asia/Bangkok"
            />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
              className="px-6 text-neutral-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white min-w-[140px] shadow-lg shadow-indigo-500/20 rounded-xl"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (contest ? 'Save Changes' : 'Create Contest')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
