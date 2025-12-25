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
  });

  useEffect(() => {
    if (contest) {
      setFormData({
        name: contest.name,
        description: contest.description,
        start: formatDateForInput(contest.start),
        stop: formatDateForInput(contest.stop),
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
      // createContest/updateContest expect Omit<contests, ...> & { start: string|Date, stop: string|Date ... }
      // formData contains strings for start/stop which are valid inputs (parsed by Date constructor if needed or accepted as string)
      // but TypeScript needs reassurance.
      const payload = {
        name: formData.name,
        description: formData.description,
        start: formData.start,
        stop: formData.stop,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-white mb-6">
          {contest ? 'Edit Contest' : 'Create New Contest'}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Contest Name</label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-neutral-600"
              placeholder="IOI 2025 Selection Round 1"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Description</label>
            <textarea
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all h-24 resize-none placeholder:text-neutral-600"
              placeholder="Detailed description of the contest..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-400">Start Time</label>
                <input
                    required
                    type="datetime-local"
                    value={formData.start}
                    onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all [color-scheme:dark]"
                />
            </div>
             <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-400">Stop Time</label>
                <input
                    required
                    type="datetime-local"
                    value={formData.stop}
                    onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all [color-scheme:dark]"
                />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              className="bg-indigo-500 hover:bg-indigo-600 text-white min-w-[100px]"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (contest ? 'Save Changes' : 'Create Contest')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
