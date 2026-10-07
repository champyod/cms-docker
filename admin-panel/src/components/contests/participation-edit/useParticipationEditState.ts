'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updateParticipation, sendMessage } from '@/app/actions/participations';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import type { PasswordKind } from '@/lib/password-format';

interface ParticipationInput { id: number; hidden: boolean; unrestricted: boolean; password: string | null; users: { username: string; first_name: string; last_name: string }; }

export function useParticipationEditState(isOpen: boolean, participation: ParticipationInput, adminId: number, onClose: () => void) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'settings' | 'message'>('settings');
  const [formData, setFormData] = useState({ hidden: participation.hidden, unrestricted: participation.unrestricted, extra_time_minutes: 0, delay_time_minutes: 0, password: '', password_kind: 'plaintext' as PasswordKind });
  const [messageData, setMessageData] = useState({ subject: '', text: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData({ hidden: participation.hidden, unrestricted: participation.unrestricted, extra_time_minutes: 0, delay_time_minutes: 0, password: '', password_kind: 'plaintext' });
      setError('');
    }
  }, [isOpen, participation.id, participation.hidden, participation.unrestricted]);

  const handleClose = () => { onClose(); };

  const runAction = useActionFeedback();

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
      const result = await runAction(
        {
          pending: 'Saving participation...',
          success: 'Participation saved',
          failure: 'Save failed',
          description: 'Settings updated successfully.',
        },
        () => updateParticipation(participation.id, payload)
      );
      if (!result) return;
      if (result.success) {
        router.refresh();
      } else setError(result.error || 'Failed to update');
    }
    finally { setSaving(false); }
  };

  const handleSendMessage = async () => {
    if (!messageData.subject.trim() || !messageData.text.trim()) return;
    setSaving(true);
    try {
      const result = await runAction(
        {
          pending: 'Sending message...',
          success: 'Message sent',
          failure: 'Send failed',
          description: 'The participant will see it on their contest page.',
        },
        () => sendMessage(participation.id, adminId, messageData)
      );
      if (!result) return;
      if (result.success) {
        setMessageData({ subject: '', text: '' });
        handleClose();
      } else setError(result.error || 'Failed to send message');
    }
    finally { setSaving(false); }
  };

  return { activeTab, setActiveTab, formData, setFormData, messageData, setMessageData, saving, error, handleClose, handleSave, handleSendMessage };
}
