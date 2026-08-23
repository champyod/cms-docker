'use client';

import { X, User, Shield, Mail } from 'lucide-react';
import { Portal } from '../core/Portal';
import { useParticipationEditState } from './participation-edit/useParticipationEditState';
import { SettingsTab, MessageTab } from './participation-edit/ParticipationEditTabs';

interface ParticipationEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  participation: { id: number; hidden: boolean; unrestricted: boolean; password: string | null; users: { username: string; first_name: string; last_name: string } };
  adminId: number;
}

export function ParticipationEditModal({ isOpen, onClose, participation, adminId }: ParticipationEditModalProps) {
  const s = useParticipationEditState(isOpen, participation, adminId, onClose);
  if (!isOpen) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={s.handleClose}>
        <div className="relative z-10 w-full max-w-lg mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-2"><User className="w-5 h-5 text-indigo-400" /><h2 className="text-lg font-bold text-white">Edit: {participation.users.username}</h2></div>
            <button onClick={s.handleClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-neutral-400" /></button>
          </div>
          <div className="flex border-b border-white/10">
            <button onClick={() => s.setActiveTab('settings')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${s.activeTab === 'settings' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'}`}><Shield className="w-4 h-4" />Settings</button>
            <button onClick={() => s.setActiveTab('message')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${s.activeTab === 'message' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'}`}><Mail className="w-4 h-4" />Send Message</button>
          </div>
          {s.error && <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{s.error}</div>}
          <div className="p-4">
            {s.activeTab === 'settings' ? (
              <SettingsTab formData={s.formData} onForm={(p) => s.setFormData({ ...s.formData, ...p })} revealed={s.revealed} revealTab={s.revealTab} onRevealTab={s.setRevealTab} revealError={s.revealError} revealing={s.revealing} onReveal={s.handleReveal} onClose={s.handleClose} onSave={s.handleSave} saving={s.saving} />
            ) : (
              <MessageTab messageData={s.messageData} onMessage={(p) => s.setMessageData({ ...s.messageData, ...p })} onClose={s.handleClose} onSend={s.handleSendMessage} saving={s.saving} />
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
