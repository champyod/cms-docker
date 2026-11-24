'use client';

import { Button } from '@/components/core/Button';
import type { Dictionary } from '@/lib/dictionary';
import { EmptyState } from '@/components/core/EmptyState';
import { RowActions } from '@/components/core/RowActions';
import { Users, Plus, Trash2, Settings, FlaskConical } from 'lucide-react';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import { cn } from '@/lib/utils';

interface ParticipationUser { username: string; first_name: string; last_name: string; }

interface Participation { id: number; user_id: number; unrestricted: boolean; hidden: boolean; users: ParticipationUser | null; teams?: { code: string } | null; }

interface Props {
  /** The section's own words: two chips and the empty state. */
  copy: Dictionary['contests']['participants'];
  participations: Participation[];
  permissionKeys: readonly string[];
  onAddParticipant: () => void;
  onAddTeam: () => void;
  onMarkAsTest: (id: number) => void;
  onOpenSettings: (id: number, username: string) => void;
  onRemove: (id: number) => void;
}

const CHIP_CLASSES = 'rounded-full px-2 py-0.5 text-xs';

function ParticipationChips({ participation, copy }: {
  participation: Participation;
  copy: Dictionary['contests']['participants'];
}): React.JSX.Element {
  return (
    <>
      {participation.teams && <span className={cn(CHIP_CLASSES, 'bg-primary/10 text-primary')}>{participation.teams.code}</span>}
      {participation.unrestricted && <span className={cn(CHIP_CLASSES, 'bg-warning/10 text-warning')}>{copy.unrestricted}</span>}
      {participation.hidden && <span className={cn(CHIP_CLASSES, 'bg-muted text-muted-foreground')}>{copy.hidden}</span>}
    </>
  );
}

// Rows without a linked user still render: the reader types user as nullable.
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

function ParticipantActions({ participation, permissionKeys, onMarkAsTest, onOpenSettings, onRemove }: Pick<Props, 'onMarkAsTest' | 'onOpenSettings' | 'onRemove' | 'permissionKeys'> & { participation: Participation }): React.JSX.Element {
  const username = participation.users?.username || 'Unknown participant';
  return (
    <RowActions
      ariaLabel="Participants"
      permissionKeys={permissionKeys}
      actions={[
        { key: 'test', label: 'Mark as Test User', icon: FlaskConical, onClick: () => onMarkAsTest(participation.id), permission: ACTION_PERMISSIONS.setTestUser },
        { key: 'settings', label: 'Settings', icon: Settings, onClick: () => onOpenSettings(participation.id, username), permission: ACTION_PERMISSIONS.updateParticipation },
        { key: 'remove', label: `Remove ${username}`, icon: Trash2, onClick: () => onRemove(participation.id), permission: ACTION_PERMISSIONS.removeParticipant },
      ]}
    />
  );
}

export function ContestParticipantsSection({
  participations,
  permissionKeys,
  onAddParticipant,
  onAddTeam,
  onMarkAsTest,
  onOpenSettings,
  onRemove,
  copy,
}: Props): React.JSX.Element {
  const effective = new Set(permissionKeys);
  return (
    <div>
      {hasEffectivePermission(effective, ACTION_PERMISSIONS.addParticipant) && (
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
              <ParticipationChips participation={participation} copy={copy} />
              <ParticipantActions participation={participation} permissionKeys={permissionKeys} onMarkAsTest={onMarkAsTest} onOpenSettings={onOpenSettings} onRemove={onRemove} />
            </div>
          </div>
        ))}
        {participations.length === 0 && <EmptyState icon={Users} title={copy.empty} />}
      </div>
    </div>
  );
}
