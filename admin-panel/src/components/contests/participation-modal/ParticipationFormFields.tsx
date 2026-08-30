'use client';

import { Users, Clock, Network, Calendar, Key } from 'lucide-react';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import type { ParticipationFormData } from './useParticipationForm';

const LABEL_CLASSES = 'mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

interface Props {
  formData: ParticipationFormData;
  onChange: (patch: Partial<ParticipationFormData>) => void;
  teams: Array<{ id: number; name: string; code: string }>;
}

export function ParticipationFormFields({ formData, onChange, teams }: Props) {
  return (
    <>
      <div>
        <label className={LABEL_CLASSES}><Users className="h-3 w-3" /> Team</label>
        <select value={formData.team_id ?? ''} onChange={(e) => onChange({ team_id: e.target.value ? parseInt(e.target.value, 10) : null })} className={FIELD_CLASSES}>
          <option value="">No Team</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.code})</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
          <input type="checkbox" checked={formData.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} className="h-4 w-4 rounded" />
          <div><div className="text-sm font-medium text-foreground">Hidden</div><div className="text-xs text-muted-foreground">Hide from ranking</div></div>
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
          <input type="checkbox" checked={formData.unrestricted} onChange={(e) => onChange({ unrestricted: e.target.checked })} className="h-4 w-4 rounded" />
          <div><div className="text-sm font-medium text-foreground">Unrestricted</div><div className="text-xs text-muted-foreground">Bypass limits</div></div>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASSES}><Clock className="h-3 w-3" /> Extra Time (seconds)</label>
          <input type="number" min="0" value={formData.extra_time_seconds} onChange={(e) => onChange({ extra_time_seconds: parseInt(e.target.value, 10) || 0 })} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}><Clock className="h-3 w-3" /> Delay Time (seconds)</label>
          <input type="number" min="0" value={formData.delay_time_seconds} onChange={(e) => onChange({ delay_time_seconds: parseInt(e.target.value, 10) || 0 })} className={FIELD_CLASSES} />
        </div>
      </div>
      <div>
        <label className={LABEL_CLASSES}><Network className="h-3 w-3" /> IP Address / Subnet</label>
        <input type="text" value={formData.ip} onChange={(e) => onChange({ ip: e.target.value })} placeholder="e.g., 192.168.1.0/24, 10.0.0.1" className={FIELD_CLASSES} />
        <p className="mt-1 text-xs text-muted-foreground">Comma-separated list of IPs or subnets in CIDR notation</p>
      </div>
      <div>
        <label className={LABEL_CLASSES}><Calendar className="h-3 w-3" /> Starting Time (USACO-style)</label>
        <input type="datetime-local" value={formData.starting_time} onChange={(e) => onChange({ starting_time: e.target.value })} className={FIELD_CLASSES} />
        <p className="mt-1 text-xs text-muted-foreground">Time of first login for per-user time contests</p>
      </div>
      <div>
        <label className={LABEL_CLASSES}><Key className="h-3 w-3" /> Contest Password</label>
        <PasswordFieldWithKind label="" value={formData.password} onChange={(password) => onChange({ password })} placeholder="Leave blank to keep current password" kind={formData.password_kind} onKind={(password_kind) => onChange({ password_kind })} />
      </div>
    </>
  );
}
