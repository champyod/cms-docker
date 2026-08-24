'use client';

import { Users, Clock, Network, Calendar, Key } from 'lucide-react';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import type { ParticipationFormData } from './useParticipationForm';

interface Props {
  formData: ParticipationFormData;
  onChange: (patch: Partial<ParticipationFormData>) => void;
  teams: Array<{ id: number; name: string; code: string }>;
}

export function ParticipationFormFields({ formData, onChange, teams }: Props) {
  return (
    <>
      <div>
        <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2"><Users className="w-3 h-3" /> Team</label>
        <select value={formData.team_id ?? ''} onChange={(e) => onChange({ team_id: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50">
          <option value="">No Team</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.code})</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
          <input type="checkbox" checked={formData.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} className="w-4 h-4 rounded" />
          <div><div className="text-sm font-medium text-white">Hidden</div><div className="text-xs text-neutral-500">Hide from ranking</div></div>
        </label>
        <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
          <input type="checkbox" checked={formData.unrestricted} onChange={(e) => onChange({ unrestricted: e.target.checked })} className="w-4 h-4 rounded" />
          <div><div className="text-sm font-medium text-white">Unrestricted</div><div className="text-xs text-neutral-500">Bypass limits</div></div>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2"><Clock className="w-3 h-3" /> Extra Time (seconds)</label>
          <input type="number" min="0" value={formData.extra_time_seconds} onChange={(e) => onChange({ extra_time_seconds: parseInt(e.target.value, 10) || 0 })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50" />
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2"><Clock className="w-3 h-3" /> Delay Time (seconds)</label>
          <input type="number" min="0" value={formData.delay_time_seconds} onChange={(e) => onChange({ delay_time_seconds: parseInt(e.target.value, 10) || 0 })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50" />
        </div>
      </div>
      <div>
        <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2"><Network className="w-3 h-3" /> IP Address / Subnet</label>
        <input type="text" value={formData.ip} onChange={(e) => onChange({ ip: e.target.value })} placeholder="e.g., 192.168.1.0/24, 10.0.0.1" className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50" />
        <p className="text-xs text-neutral-500 mt-1">Comma-separated list of IPs or subnets in CIDR notation</p>
      </div>
      <div>
        <label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase mb-2"><Calendar className="w-3 h-3" /> Starting Time (USACO-style)</label>
        <input type="datetime-local" value={formData.starting_time} onChange={(e) => onChange({ starting_time: e.target.value })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50" />
        <p className="text-xs text-neutral-500 mt-1">Time of first login for per-user time contests</p>
      </div>
      <div>
        <div className="mb-1"><label className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase"><Key className="w-3 h-3" /> Contest Password</label></div>
        <PasswordFieldWithKind label="" value={formData.password} onChange={(password) => onChange({ password })} placeholder="Leave blank to keep current password" kind={formData.password_kind} onKind={(password_kind) => onChange({ password_kind })} />
      </div>
    </>
  );
}
