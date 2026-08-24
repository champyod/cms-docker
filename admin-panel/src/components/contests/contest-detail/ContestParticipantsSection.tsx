'use client';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Users, Plus, Trash2, Settings, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const CHIP_CLASSES = 'rounded-full px-2 py-0.5 text-xs';

function ParticipationChips({ participation }: { participation: Participation }) {
  return (
    <>
      {participation.teams && <span className={cn(CHIP_CLASSES, 'bg-primary/10 text-primary')}>{participation.teams.code}</span>}
      {participation.unrestricted && <span className={cn(CHIP_CLASSES, 'bg-warning/10 text-warning')}>Unrestricted</span>}
      {participation.hidden && <span className={cn(CHIP_CLASSES, 'bg-muted text-muted-foreground')}>Hidden</span>}
    </>
  );
}

function RowActions({ participation, onMarkAsTest, onOpenSettings, onRemove }: Pick<Props, 'onMarkAsTest' | 'onOpenSettings' | 'onRemove'> & { participation: Participation }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onMarkAsTest(participation.id)} className="p-1.5 text-muted-foreground opacity-0 transition-colors hover:text-warning group-hover:opacity-100" title="Mark as Test User"><FlaskConical className="h-4 w-4" /></button>
      <button onClick={() => onOpenSettings(participation.id, participation.users.username)} className="p-1.5 text-muted-foreground opacity-0 transition-colors hover:text-primary group-hover:opacity-100" title="Settings"><Settings className="h-4 w-4" /></button>
      <button onClick={() => onRemove(participation.id)} className="p-1.5 text-muted-foreground opacity-0 transition-colors hover:text-destructive group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
    </div>
  );
}

export function ContestParticipantsSection({ participations, expanded, onToggle, onAddParticipant, onAddTeam, onMarkAsTest, onOpenSettings, onRemove }: Props) {
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3"><Users className="h-5 w-5 text-success" /><span className="font-bold text-foreground">Participants ({participations.length})</span></div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div>
          <div className="flex justify-end gap-2 border-b border-border bg-muted/20 p-4">
            <Button variant="secondary" size="sm" icon={Users} onClick={onAddTeam}>Add Team</Button>
            <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAddParticipant}>Add Participant</Button>
          </div>
          <div className="divide-y divide-border">
            {participations.map((participation) => (
              <div key={participation.id} className="group flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-xs font-bold text-success">{participation.users.username.substring(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="font-medium text-foreground">{participation.users.username}</div>
                    <div className="text-xs text-muted-foreground">{participation.users.first_name} {participation.users.last_name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ParticipationChips participation={participation} />
                  <RowActions participation={participation} onMarkAsTest={onMarkAsTest} onOpenSettings={onOpenSettings} onRemove={onRemove} />
                </div>
              </div>
            ))}
            {participations.length === 0 && <EmptyState icon={Users} title="No participants yet" />}
          </div>
        </div>
      )}
    </Card>
  );
}
