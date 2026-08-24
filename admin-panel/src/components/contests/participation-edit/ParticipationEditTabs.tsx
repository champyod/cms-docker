'use client';

import { Eye } from 'lucide-react';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import { PasswordRevealPanel } from './PasswordRevealPanel';
import type { RevealedState } from './useParticipationEditState';
import type { PasswordKind } from '@/lib/password-format';

interface SettingsForm {
  hidden: boolean;
  unrestricted: boolean;
  extra_time_minutes: number;
  delay_time_minutes: number;
  password: string;
  password_kind: PasswordKind;
}

interface SettingsProps {
  formData: SettingsForm;
  onForm: (p: Partial<SettingsForm>) => void;
  revealed: RevealedState;
  revealTab: 'plain' | 'stored';
  onRevealTab: (t: 'plain' | 'stored') => void;
  revealError: string;
  revealing: boolean;
  onReveal: () => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

export function SettingsTab({ formData, onForm, revealed, revealTab, onRevealTab, revealError, revealing, onReveal, onClose, onSave, saving }: SettingsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Extra Time (min)</label><input type="number" value={formData.extra_time_minutes} onChange={(e) => onForm({ extra_time_minutes: parseInt(e.target.value, 10) || 0 })} className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm" /></div>
        <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Delay Time (min)</label><input type="number" value={formData.delay_time_minutes} onChange={(e) => onForm({ delay_time_minutes: parseInt(e.target.value, 10) || 0 })} className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm" /></div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold text-neutral-500 uppercase">Password (optional)</label>
          <button type="button" onClick={onReveal} disabled={revealing} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white/10 hover:bg-white/15 text-neutral-200 border border-white/10 rounded-lg transition-colors disabled:opacity-50"><Eye className="w-3.5 h-3.5" />{revealing ? 'Revealing…' : 'Reveal current'}</button>
        </div>
        <PasswordFieldWithKind label="" value={formData.password} onChange={(password) => onForm({ password })} placeholder="Leave blank to keep current password" kind={formData.password_kind} onKind={(password_kind) => onForm({ password_kind })} />
        {revealError && <p className="text-xs text-red-400 mt-2">{revealError}</p>}
        <PasswordRevealPanel revealed={revealed} revealTab={revealTab} onTab={onRevealTab} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><div><label className="text-sm text-neutral-300">Hidden</label><p className="text-xs text-neutral-500">User won&apos;t appear in ranking</p></div><input type="checkbox" checked={formData.hidden} onChange={(e) => onForm({ hidden: e.target.checked })} className="w-4 h-4 rounded" /></div>
        <div className="flex items-center justify-between"><div><label className="text-sm text-neutral-300">Unrestricted</label><p className="text-xs text-neutral-500">Bypass contest constraints</p></div><input type="checkbox" checked={formData.unrestricted} onChange={(e) => onForm({ unrestricted: e.target.checked })} className="w-4 h-4 rounded" /></div>
      </div>
      <div className="flex gap-3 pt-4">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg">Cancel</button>
        <button onClick={onSave} disabled={saving} className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

interface MessageProps {
  messageData: { subject: string; text: string };
  onMessage: (p: Partial<{ subject: string; text: string }>) => void;
  onClose: () => void;
  onSend: () => void;
  saving: boolean;
}

export function MessageTab({ messageData, onMessage, onClose, onSend, saving }: MessageProps) {
  return (
    <div className="space-y-4">
      <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Subject</label><input type="text" value={messageData.subject} onChange={(e) => onMessage({ subject: e.target.value })} className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm" /></div>
      <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Message</label><textarea value={messageData.text} onChange={(e) => onMessage({ text: e.target.value })} rows={4} className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm" /></div>
      <div className="flex gap-3 pt-4">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg">Cancel</button>
        <button onClick={onSend} disabled={saving || !messageData.subject.trim() || !messageData.text.trim()} className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">{saving ? 'Sending...' : 'Send Message'}</button>
      </div>
    </div>
  );
}
