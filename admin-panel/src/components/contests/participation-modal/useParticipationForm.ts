'use client';

import { useState, useEffect, useCallback } from 'react';
import { getParticipationDetails, updateParticipation } from '@/app/actions/participations';
import type { PasswordKind } from '@/lib/password-format';

export interface ParticipationFormData {
  team_id: number | null;
  hidden: boolean;
  unrestricted: boolean;
  extra_time_seconds: number;
  delay_time_seconds: number;
  ip: string;
  starting_time: string;
  password: string;
  password_kind: PasswordKind;
}

const INITIAL: ParticipationFormData = {
  team_id: null, hidden: false, unrestricted: false, extra_time_seconds: 0, delay_time_seconds: 0, ip: '', starting_time: '', password: '', password_kind: 'plaintext',
};

export function useParticipationForm(isOpen: boolean, participationId: number) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<ParticipationFormData>(INITIAL);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getParticipationDetails(participationId) as { team_id: number | null; hidden: boolean; unrestricted: boolean; extra_time_seconds: number; delay_time_seconds: number; ip_string: string; starting_time: string } | null;
      if (data) {
        setFormData({ team_id: data.team_id, hidden: data.hidden, unrestricted: data.unrestricted, extra_time_seconds: data.extra_time_seconds, delay_time_seconds: data.delay_time_seconds, ip: data.ip_string, starting_time: data.starting_time, password: '', password_kind: 'plaintext' });
      }
    } catch {
      setError('Failed to load participation data');
    } finally {
      setLoading(false);
    }
  }, [participationId]);

  useEffect(() => {
    if (isOpen && participationId) void load();
  }, [isOpen, participationId, load]);

  const submit = async (onSuccess: () => void, onClose: () => void): Promise<void> => {
    setError('');
    setSaving(true);
    try {
      const payload: Parameters<typeof updateParticipation>[1] = {
        team_id: formData.team_id, hidden: formData.hidden, unrestricted: formData.unrestricted,
        extra_time_seconds: formData.extra_time_seconds, delay_time_seconds: formData.delay_time_seconds,
        ip: formData.ip, starting_time: formData.starting_time || null,
      };
      if (formData.password.trim().length > 0) {
        payload.password = formData.password;
        payload.passwordKind = formData.password_kind;
      }
      const result = await updateParticipation(participationId, payload);
      if (result.success) { onSuccess(); onClose(); }
      else setError(result.error || 'Failed to update participation');
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  return { loading, saving, error, formData, setFormData, submit };
}
