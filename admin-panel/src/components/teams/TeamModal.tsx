'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';

interface TeamData {
  id?: number;
  code: string;
  name: string;
}

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TeamData | null;
}

export function TeamModal({ isOpen, onClose, onSuccess, initialData }: TeamModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({ code: initialData.code, name: initialData.name });
    } else {
      setFormData({ code: '', name: '' });
    }
    setError('');
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    const result = (initialData && initialData.id)
      ? await apiClient.put(`/api/teams/${initialData.id}`, formData)
      : await apiClient.post('/api/teams', formData);

    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error || 'Operation failed');
    }
    setLoading(false);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initialData ? 'Edit Team' : 'Add Team'}
      className="sm:max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Team Code
          </label>
          <input
            type="text"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            className="w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors font-mono"
            placeholder="e.g. THA-01"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Team Name
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors"
            placeholder="e.g. Thailand Team 1"
          />
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="negativeOutline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="positive" loading={loading} disabled={loading}>
            {initialData ? 'Update Team' : 'Create Team'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
