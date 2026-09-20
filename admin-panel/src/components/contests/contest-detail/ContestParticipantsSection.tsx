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
    <div className="flex items-center gap-1">
      <Button variant="ghost" iconOnly icon={FlaskConical} tooltip="Mark as Test User" onClick={() => onMarkAsTest(participation.id)} className="size-9 shrink-0 rounded-lg hover:text-warning" />
      <Button variant="ghost" iconOnly icon={Settings} tooltip="Settings" onClick={() => onOpenSettings(participation.id, participation.users.username)} className="size-9 shrink-0 rounded-lg hover:text-primary" />
      <Button variant="ghost" iconOnly icon={Trash2} tooltip="Remove" aria-label={`Remove ${participation.users.username}`} onClick={() => onRemove(participation.id)} className="size-9 shrink-0 rounded-lg hover:text-destructive" />
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
              <div key={participation.id} className="group flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-xs font-bold text-success">{participation.users.username.substring(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="font-medium text-foreground">{participation.users.username}</div>
                    <div className="text-xs text-muted-foreground">{participation.users.first_name} {participation.users.last_name}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
