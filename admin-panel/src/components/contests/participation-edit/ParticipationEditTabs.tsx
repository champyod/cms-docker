'use client';

import { Eye } from 'lucide-react';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import { Button } from '@/components/core/Button';
import { PasswordRevealPanel } from './PasswordRevealPanel';
import type { RevealedState } from './useParticipationEditState';
import type { PasswordKind } from '@/lib/password-format';

const LABEL_CLASSES = 'mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

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
        <div><label className={LABEL_CLASSES}>Extra Time (min)</label><input type="number" value={formData.extra_time_minutes} onChange={(e) => onForm({ extra_time_minutes: parseInt(e.target.value, 10) || 0 })} className={FIELD_CLASSES} /></div>
        <div><label className={LABEL_CLASSES}>Delay Time (min)</label><input type="number" value={formData.delay_time_minutes} onChange={(e) => onForm({ delay_time_minutes: parseInt(e.target.value, 10) || 0 })} className={FIELD_CLASSES} /></div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">Password (optional)</label>
          <Button type="button" size="sm" variant="secondary" icon={Eye} loading={revealing} disabled={revealing} onClick={onReveal}>{revealing ? 'Revealing…' : 'Reveal current'}</Button>
        </div>
        <PasswordFieldWithKind label="" value={formData.password} onChange={(password) => onForm({ password })} placeholder="Leave blank to keep current password" kind={formData.password_kind} onKind={(password_kind) => onForm({ password_kind })} />
        {revealError && <p className="mt-2 text-xs text-destructive">{revealError}</p>}
        <PasswordRevealPanel revealed={revealed} revealTab={revealTab} onTab={onRevealTab} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><div><label className="text-sm text-foreground">Hidden</label><p className="text-xs text-muted-foreground">User won&apos;t appear in ranking</p></div><input type="checkbox" checked={formData.hidden} onChange={(e) => onForm({ hidden: e.target.checked })} className="h-4 w-4 rounded" /></div>
        <div className="flex items-center justify-between"><div><label className="text-sm text-foreground">Unrestricted</label><p className="text-xs text-muted-foreground">Bypass contest constraints</p></div><input type="checkbox" checked={formData.unrestricted} onChange={(e) => onForm({ unrestricted: e.target.checked })} className="h-4 w-4 rounded" /></div>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button variant="positive" className="flex-1" loading={saving} disabled={saving} onClick={onSave}>{saving ? 'Saving...' : 'Save Changes'}</Button>
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
      <div><label className={LABEL_CLASSES}>Subject</label><input type="text" value={messageData.subject} onChange={(e) => onMessage({ subject: e.target.value })} className={FIELD_CLASSES} /></div>
      <div><label className={LABEL_CLASSES}>Message</label><textarea value={messageData.text} onChange={(e) => onMessage({ text: e.target.value })} rows={4} className={FIELD_CLASSES} /></div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button variant="positive" className="flex-1" loading={saving} disabled={saving || !messageData.subject.trim() || !messageData.text.trim()} onClick={onSend}>{saving ? 'Sending...' : 'Send Message'}</Button>
      </div>
    </div>
  );
}
