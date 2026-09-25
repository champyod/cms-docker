'use client';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Users, Plus, Trash2, Settings, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { cn } from '@/lib/utils';

interface ParticipationUser { username: string; first_name: string; last_name: string; }

interface Participation { id: number; user_id: number; unrestricted: boolean; hidden: boolean; users: ParticipationUser | null; teams?: { code: string } | null; }

interface Props {
  participations: Participation[];
  expanded: boolean;
  permissionKeys: readonly string[];
  onToggle: () => void;
  onAddParticipant: () => void;
  onAddTeam: () => void;
  onMarkAsTest: (id: number) => void;
  onOpenSettings: (id: number, username: string) => void;
  onRemove: (id: number) => void;
}

interface ParticipationGates { canInvite: boolean; canMarkTest: boolean; canRemove: boolean; }

// Why: invite, test-marking, and removal are separate server actions — each
// control renders only when its own action permission is present.
function useParticipationGates(permissionKeys: readonly string[]): ParticipationGates {
  const effective = new Set(permissionKeys);
  return {
    canInvite: hasEffectivePermission(effective, 'participation:create'),
    canMarkTest: hasEffectivePermission(effective, 'participation:update'),
    canRemove: hasEffectivePermission(effective, 'participation:delete'),
  };
}

const CHIP_CLASSES = 'rounded-full px-2 py-0.5 text-xs';

function ParticipationChips({ participation }: { participation: Participation }): React.JSX.Element {
  return (
    <>
      {participation.teams && <span className={cn(CHIP_CLASSES, 'bg-primary/10 text-primary')}>{participation.teams.code}</span>}
      {participation.unrestricted && <span className={cn(CHIP_CLASSES, 'bg-warning/10 text-warning')}>Unrestricted</span>}
      {participation.hidden && <span className={cn(CHIP_CLASSES, 'bg-muted text-muted-foreground')}>Hidden</span>}
    </>
  );
}

// Why: rows without a linked user still render — the reader types user as
// nullable, so labels fall back instead of crashing on a missing relation.
function ParticipationIdentity({ participation }: { participation: Participation }): React.JSX.Element {
  const username = participation.users?.username || 'Unknown participant';
  const fullName = participation.users ? `${participation.users.first_name} ${participation.users.last_name}`.trim() : '';
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-xs font-bold text-success">{username.substring(0, 2).toUpperCase()}</div>
      <div>
        <div className="font-medium text-foreground">{username}</div>
        {fullName && <div className="text-xs text-muted-foreground">{fullName}</div>}
      </div>
    </div>
  );
}

function RowActions({ participation, gates, onMarkAsTest, onOpenSettings, onRemove }: Pick<Props, 'onMarkAsTest' | 'onOpenSettings' | 'onRemove'> & { participation: Participation; gates: ParticipationGates }): React.JSX.Element | null {
  if (!gates.canMarkTest && !gates.canRemove) return null;
  const username = participation.users?.username || 'Unknown participant';
  return (
    <div className="flex items-center gap-1">
      {gates.canMarkTest && (
        <Button variant="ghost" iconOnly icon={FlaskConical} tooltip="Mark as Test User" onClick={() => onMarkAsTest(participation.id)} className="shrink-0 rounded-lg hover:text-warning" />
      )}
      <Button variant="ghost" iconOnly icon={Settings} tooltip="Settings" onClick={() => onOpenSettings(participation.id, username)} className="shrink-0 rounded-lg hover:text-primary" />
      {gates.canRemove && (
        <Button variant="ghost" iconOnly icon={Trash2} tooltip="Remove" aria-label={`Remove ${username}`} onClick={() => onRemove(participation.id)} className="shrink-0 rounded-lg hover:text-destructive" />
      )}
    </div>
  );
}

export function ContestParticipantsSection({ participations, expanded, permissionKeys, onToggle, onAddParticipant, onAddTeam, onMarkAsTest, onOpenSettings, onRemove }: Props): React.JSX.Element {
  const gates = useParticipationGates(permissionKeys);
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3"><Users className="h-5 w-5 text-success" /><span className="font-bold text-foreground">Participants ({participations.length})</span></div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div>
          {gates.canInvite && (
            <div className="flex justify-end gap-2 border-b border-border bg-muted/20 p-4">
              <Button variant="secondary" size="sm" icon={Users} onClick={onAddTeam}>Add Team</Button>
              <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAddParticipant}>Add Participant</Button>
            </div>
          )}
          <div className="divide-y divide-border">
            {participations.map((participation) => (
              <div key={participation.id} className="group flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
                <ParticipationIdentity participation={participation} />
                <div className="flex flex-wrap items-center gap-2">
                  <ParticipationChips participation={participation} />
                  <RowActions participation={participation} gates={gates} onMarkAsTest={onMarkAsTest} onOpenSettings={onOpenSettings} onRemove={onRemove} />
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
