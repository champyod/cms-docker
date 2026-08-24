'use client';

import { Shield, Mail } from 'lucide-react';
import { useParticipationEditState } from './participation-edit/useParticipationEditState';
import { SettingsTab, MessageTab } from './participation-edit/ParticipationEditTabs';
import { Dialog } from '@/components/core/Dialog';
import { cn } from '@/lib/utils';

interface ParticipationEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  participation: { id: number; hidden: boolean; unrestricted: boolean; password: string | null; users: { username: string; first_name: string; last_name: string } };
  adminId: number;
}

const TAB_BASE = 'flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors';
const TAB_ACTIVE = 'bg-card text-foreground shadow-xs';
const TAB_INACTIVE = 'text-muted-foreground hover:text-foreground';

function EditTabs({ activeTab, onSelect }: { activeTab: 'settings' | 'message'; onSelect: (tab: 'settings' | 'message') => void }) {
  return (
    <div className="mb-4 flex gap-1 rounded-lg bg-muted/50 p-1">
      <button type="button" onClick={() => onSelect('settings')} className={cn(TAB_BASE, activeTab === 'settings' ? TAB_ACTIVE : TAB_INACTIVE)}><Shield className="h-4 w-4" />Settings</button>
      <button type="button" onClick={() => onSelect('message')} className={cn(TAB_BASE, activeTab === 'message' ? TAB_ACTIVE : TAB_INACTIVE)}><Mail className="h-4 w-4" />Send Message</button>
    </div>
  );
}

export function ParticipationEditModal({ isOpen, onClose, participation, adminId }: ParticipationEditModalProps) {
  const s = useParticipationEditState(isOpen, participation, adminId, onClose);
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) s.handleClose(); }} title={`Edit: ${participation.users.username}`}>
      <EditTabs activeTab={s.activeTab} onSelect={s.setActiveTab} />
      {s.error && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{s.error}</div>}
      {s.activeTab === 'settings' ? (
        <SettingsTab formData={s.formData} onForm={(p) => s.setFormData({ ...s.formData, ...p })} revealed={s.revealed} revealTab={s.revealTab} onRevealTab={s.setRevealTab} revealError={s.revealError} revealing={s.revealing} onReveal={s.handleReveal} onClose={s.handleClose} onSave={s.handleSave} saving={s.saving} />
      ) : (
        <MessageTab messageData={s.messageData} onMessage={(p) => s.setMessageData({ ...s.messageData, ...p })} onClose={s.handleClose} onSend={s.handleSendMessage} saving={s.saving} />
      )}
    </Dialog>
  );
}
