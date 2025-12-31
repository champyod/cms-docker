'use client';

import { useState, useEffect } from 'react';
import { X, User, Clock, Shield, Mail } from 'lucide-react';
import { Portal } from '../core/Portal';
import { updateParticipation, sendMessage } from '@/app/actions/participations';

interface ParticipationEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  participation: {
    id: number;
    hidden: boolean;
    unrestricted: boolean;
    password: string | null;
    users: { username: string; first_name: string; last_name: string };
  };
  adminId: number;
}

export function ParticipationEditModal({ isOpen, onClose, participation, adminId }: ParticipationEditModalProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'message'>('settings');
  const [formData, setFormData] = useState({
    hidden: participation.hidden,
    unrestricted: participation.unrestricted,
    extra_time_minutes: 0,
    delay_time_minutes: 0,
    password: participation.password || '',
  });
  const [messageData, setMessageData] = useState({
    subject: '',
    text: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await updateParticipation(participation.id, {
        hidden: formData.hidden,
        unrestricted: formData.unrestricted,
        password: formData.password || null,
        extra_time_seconds: formData.extra_time_minutes * 60,
        delay_time_seconds: formData.delay_time_minutes * 60,
      });
      if (result.success) {
        window.location.reload();
      } else {
        setError(result.error || 'Failed to update');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageData.subject.trim() || !messageData.text.trim()) return;
    setSaving(true);
    try {
      const result = await sendMessage(participation.id, adminId, messageData);
      if (result.success) {
        setMessageData({ subject: '', text: '' });
        onClose();
      } else {
        setError(result.error || 'Failed to send message');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-lg mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">
              Edit: {participation.users.username}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${
              activeTab === 'settings' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Shield className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => setActiveTab('message')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${
              activeTab === 'message' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Mail className="w-4 h-4" />
            Send Message
          </button>
        </div>
        
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="p-4">
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Extra Time (min)</label>
                  <input
                    type="number"
                    value={formData.extra_time_minutes}
                    onChange={(e) => setFormData({ ...formData, extra_time_minutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Delay Time (min)</label>
                  <input
                    type="number"
                    value={formData.delay_time_minutes}
                    onChange={(e) => setFormData({ ...formData, delay_time_minutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Password (optional)</label>
                <input
                  type="text"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Leave empty to use user password"
                  className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm"
                />
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm text-neutral-300">Hidden</label>
                    <p className="text-xs text-neutral-500">User won't appear in ranking</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.hidden}
                    onChange={(e) => setFormData({ ...formData, hidden: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm text-neutral-300">Unrestricted</label>
                    <p className="text-xs text-neutral-500">Bypass contest constraints</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.unrestricted}
                    onChange={(e) => setFormData({ ...formData, unrestricted: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
          
          {activeTab === 'message' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Subject</label>
                <input
                  type="text"
                  value={messageData.subject}
                  onChange={(e) => setMessageData({ ...messageData, subject: e.target.value })}
                  className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Message</label>
                <textarea
                  value={messageData.text}
                  onChange={(e) => setMessageData({ ...messageData, text: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm"
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={saving || !messageData.subject.trim() || !messageData.text.trim()}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}
