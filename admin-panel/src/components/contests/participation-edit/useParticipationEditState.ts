'use client';

import { useState, useEffect } from 'react';
import { updateParticipation, sendMessage, revealParticipationPassword } from '@/app/actions/participations';
import type { PasswordKind } from '@/lib/password-format';

export type RevealedState = { kind: 'plaintext'; value: string } | { kind: 'bcrypt' } | null;

interface ParticipationInput { id: number; hidden: boolean; unrestricted: boolean; password: string | null; users: { username: string; first_name: string; last_name: string }; }

export function useParticipationEditState(isOpen: boolean, participation: ParticipationInput, adminId: number, onClose: () => void) {
  const [activeTab, setActiveTab] = useState<'settings' | 'message'>('settings');
  const [formData, setFormData] = useState({ hidden: participation.hidden, unrestricted: participation.unrestricted, extra_time_minutes: 0, delay_time_minutes: 0, password: '', password_kind: 'plaintext' as PasswordKind });
  const [messageData, setMessageData] = useState({ subject: '', text: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<RevealedState>(null);
  const [revealTab, setRevealTab] = useState<'plain' | 'stored'>('plain');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData({ hidden: participation.hidden, unrestricted: participation.unrestricted, extra_time_minutes: 0, delay_time_minutes: 0, password: '', password_kind: 'plaintext' });
      setRevealed(null); setRevealTab('plain'); setRevealError(''); setError('');
    } else {
      setRevealed(null); setRevealTab('plain'); setRevealError('');
    }
  }, [isOpen, participation.id, participation.hidden, participation.unrestricted]);

  const handleClose = () => { setRevealed(null); setRevealTab('plain'); setRevealError(''); onClose(); };

  const handleReveal = async () => {
    setRevealing(true); setRevealError('');
    try {
      const result = await revealParticipationPassword(participation.id);
      if (!result.success) { setRevealError(result.error); setRevealed(null); return; }
      if (result.kind === 'plaintext') { setRevealed({ kind: 'plaintext', value: result.value }); setRevealTab('plain'); }
      else { setRevealed({ kind: 'bcrypt' }); setRevealTab('plain'); }
    } catch { setRevealError('Unable to load password'); }
    finally { setRevealing(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const payload: { hidden: boolean; unrestricted: boolean; extra_time_seconds: number; delay_time_seconds: number; password?: string | null; passwordKind?: PasswordKind } = {
        hidden: formData.hidden, unrestricted: formData.unrestricted,
        extra_time_seconds: formData.extra_time_minutes * 60, delay_time_seconds: formData.delay_time_minutes * 60,
      };
      if (formData.password.trim().length > 0) {
        payload.password = formData.password;
        payload.passwordKind = formData.password_kind;
      }
      const result = await updateParticipation(participation.id, payload);
      if (result.success) {
        if (formData.password.trim().length > 0) { setRevealed({ kind: 'plaintext', value: formData.password }); setRevealTab('plain'); setRevealError(''); }
        window.location.reload();
      } else setError(result.error || 'Failed to update');
    } catch { setError('An error occurred'); }
    finally { setSaving(false); }
  };

  const handleSendMessage = async () => {
    if (!messageData.subject.trim() || !messageData.text.trim()) return;
    setSaving(true);
    try {
      const result = await sendMessage(participation.id, adminId, messageData);
      if (result.success) { setMessageData({ subject: '', text: '' }); handleClose(); }
      else setError(result.error || 'Failed to send message');
    } catch { setError('An error occurred'); }
    finally { setSaving(false); }
  };

  return { activeTab, setActiveTab, formData, setFormData, messageData, setMessageData, saving, error, revealed, setRevealed, revealTab, setRevealTab, revealing, revealError, handleClose, handleReveal, handleSave, handleSendMessage };
}
