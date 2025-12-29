'use client';

import { useState, useEffect } from 'react';
import { X, Settings, Users, Clock, Shield, Network, Key, Calendar } from 'lucide-react';
import { updateParticipation, getParticipationDetails } from '@/app/actions/participations';
import { teams } from '@prisma/client';

interface ParticipationModalProps {
  isOpen: boolean;
  onClose: () => void;
  participationId: number;
  username: string;
  teams: teams[];
  onSuccess: () => void;
}

export function ParticipationModal({ 
  isOpen, 
  onClose, 
  participationId, 
  username, 
  teams: availableTeams,
  onSuccess 
}: ParticipationModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    team_id: null as number | null,
    hidden: false,
    unrestricted: false,
    extra_time_seconds: 0,
    delay_time_seconds: 0,
    ip: '',
    starting_time: '',
    password: '',
  });

  useEffect(() => {
    if (isOpen && participationId) {
      loadParticipation();
    }
  }, [isOpen, participationId]);

  const loadParticipation = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getParticipationDetails(participationId);
      if (data) {
        setFormData({
          team_id: data.team_id,
          hidden: data.hidden,
          unrestricted: data.unrestricted,
          extra_time_seconds: data.extra_time_seconds,
          delay_time_seconds: data.delay_time_seconds,
          ip: data.ip_string,
          starting_time: data.starting_time,
          password: data.password || '',
        });
      }
    } catch (e) {
      setError('Failed to load participation data');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const result = await updateParticipation(participationId, {
        team_id: formData.team_id,
        hidden: formData.hidden,
        unrestricted: formData.unrestricted,
        extra_time_seconds: formData.extra_time_seconds,
        delay_time_seconds: formData.delay_time_seconds,
        ip: formData.ip,
        starting_time: formData.starting_time || null,
        password: formData.password || null,
      });

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || 'Failed to update participation');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-lg bg-neutral-900 border border-white/10 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-neutral-900">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Participation Settings</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-400">{username}</span>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>
        </div>
        
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-neutral-400">Loading...</div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Team */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                <Users className="w-3 h-3" /> Team
              </label>
              <select
                value={formData.team_id ?? ''}
                onChange={(e) => setFormData({ ...formData, team_id: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              >
                <option value="">No Team</option>
                {availableTeams.map(team => (
                  <option key={team.id} value={team.id}>{team.name} ({team.code})</option>
                ))}
              </select>
            </div>

            {/* Checkboxes */}
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.hidden}
                  onChange={(e) => setFormData({ ...formData, hidden: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-white">Hidden</div>
                  <div className="text-xs text-neutral-500">Hide from ranking</div>
                </div>
              </label>
              
              <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.unrestricted}
                  onChange={(e) => setFormData({ ...formData, unrestricted: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-white">Unrestricted</div>
                  <div className="text-xs text-neutral-500">Bypass limits</div>
                </div>
              </label>
            </div>

            {/* Time adjustments */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                  <Clock className="w-3 h-3" /> Extra Time (seconds)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.extra_time_seconds}
                  onChange={(e) => setFormData({ ...formData, extra_time_seconds: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                  <Clock className="w-3 h-3" /> Delay Time (seconds)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.delay_time_seconds}
                  onChange={(e) => setFormData({ ...formData, delay_time_seconds: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* IP Address */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                <Network className="w-3 h-3" /> IP Address / Subnet
              </label>
              <input
                type="text"
                value={formData.ip}
                onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                placeholder="e.g., 192.168.1.0/24, 10.0.0.1"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
              <p className="text-xs text-neutral-500 mt-1">Comma-separated list of IPs or subnets in CIDR notation</p>
            </div>

            {/* Starting Time */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                <Calendar className="w-3 h-3" /> Starting Time (USACO-style)
              </label>
              <input
                type="datetime-local"
                value={formData.starting_time}
                onChange={(e) => setFormData({ ...formData, starting_time: e.target.value })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
              <p className="text-xs text-neutral-500 mt-1">Time of first login for per-user time contests</p>
            </div>

            {/* Password */}
            <div>
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2">
                <Key className="w-3 h-3" /> Contest Password
              </label>
              <input
                type="text"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Leave empty to use main password"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
