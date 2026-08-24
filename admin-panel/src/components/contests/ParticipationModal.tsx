'use client';

import { useParticipationForm } from './participation-modal/useParticipationForm';
import { ParticipationFormFields } from './participation-modal/ParticipationFormFields';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit(onSuccess, onClose);
  };

  const patch = (p: Partial<typeof formData>) => setFormData({ ...formData, ...p });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Participation Settings" description={username}>
      {error && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <ParticipationFormFields formData={formData} onChange={patch} teams={availableTeams} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="positive" className="flex-1" loading={saving} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
