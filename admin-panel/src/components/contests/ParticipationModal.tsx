'use client';

import { useEffect } from 'react';
import { X, Settings } from 'lucide-react';
import { Portal } from '../core/Portal';
import { useParticipationForm } from './participation-modal/useParticipationForm';
import { ParticipationFormFields } from './participation-modal/ParticipationFormFields';

interface ParticipationModalProps {
  isOpen: boolean;
  onClose: () => void;
  participationId: number;
  username: string;
  teams: Array<{ id: number; name: string; code: string }>;
  onSuccess: () => void;
}

export function ParticipationModal({ isOpen, onClose, participationId, username, teams: availableTeams, onSuccess }: ParticipationModalProps) {
  const { loading, saving, error, formData, setFormData, submit } = useParticipationForm(isOpen, participationId);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit(onSuccess, onClose);
  };

  const patch = (p: Partial<typeof formData>) => setFormData({ ...formData, ...p });

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-lg mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-neutral-900">
            <div className="flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-400" /><h2 className="text-lg font-bold text-white">Participation Settings</h2></div>
            <div className="flex items-center gap-3"><span className="text-sm text-neutral-400">{username}</span><button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-neutral-400" /></button></div>
          </div>
          {error && <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>}
          {loading ? <div className="p-8 text-center text-neutral-400">Loading...</div> : (
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <ParticipationFormFields formData={formData} onChange={patch} teams={availableTeams} />
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Portal>
  );
}
