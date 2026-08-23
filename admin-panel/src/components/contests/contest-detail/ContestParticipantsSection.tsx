'use client';

import { Card } from '@/components/core/Card';
import { Users, Plus, Trash2, Settings, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';

interface Participation { id: number; user_id: number; unrestricted: boolean; hidden: boolean; users: { username: string; first_name: string; last_name: string }; teams?: { code: string } | null; }

interface Props {
  participations: Participation[];
  expanded: boolean;
  onToggle: () => void;
  onAddParticipant: () => void;
  onAddTeam: () => void;
  onMarkAsTest: (id: number) => void;
  onOpenSettings: (id: number, username: string) => void;
  onRemove: (id: number) => void;
}

export function ContestParticipantsSection({ participations, expanded, onToggle, onAddParticipant, onAddTeam, onMarkAsTest, onOpenSettings, onRemove }: Props) {
  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <button onClick={onToggle} className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3"><Users className="w-5 h-5 text-green-400" /><span className="font-bold text-white">Participants ({participations.length})</span></div>
        {expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
      </button>
      {expanded && (
        <div>
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-end gap-2">
            <button onClick={onAddTeam} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-600/30 transition-colors"><Users className="w-4 h-4" />Add Team</button>
            <button onClick={onAddParticipant} className="flex items-center gap-2 px-3 py-1.5 bg-green-600/20 text-green-400 rounded-lg text-sm hover:bg-green-600/30 transition-colors"><Plus className="w-4 h-4" />Add Participant</button>
          </div>
          <div className="divide-y divide-white/5">
            {participations.map((participation) => (
              <div key={participation.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-green-500 to-emerald-500 flex items-center justify-center text-xs font-bold text-white">{participation.users.username.substring(0, 2).toUpperCase()}</div>
                  <div><div className="font-medium text-white">{participation.users.username}</div><div className="text-xs text-neutral-500">{participation.users.first_name} {participation.users.last_name}</div></div>
                </div>
                <div className="flex items-center gap-2">
                  {participation.teams && <span className="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded-full">{participation.teams.code}</span>}
                  {participation.unrestricted && <span className="text-xs px-2 py-0.5 bg-amber-600/20 text-amber-400 rounded-full">Unrestricted</span>}
                  {participation.hidden && <span className="text-xs px-2 py-0.5 bg-neutral-700 text-neutral-300 rounded-full">Hidden</span>}
                  <button onClick={() => onMarkAsTest(participation.id)} className="p-1.5 text-neutral-500 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100" title="Mark as Test User"><FlaskConical className="w-4 h-4" /></button>
                  <button onClick={() => onOpenSettings(participation.id, participation.users.username)} className="p-1.5 text-neutral-500 hover:text-indigo-400 transition-colors opacity-0 group-hover:opacity-100" title="Settings"><Settings className="w-4 h-4" /></button>
                  <button onClick={() => onRemove(participation.id)} className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            {participations.length === 0 && <div className="p-8 text-center text-neutral-500 text-sm">No participants yet</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
