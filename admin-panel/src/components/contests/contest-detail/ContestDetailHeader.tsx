'use client';

import { Rocket, Power, Pencil } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { SaveButton } from '@/components/core/SaveButton';
import { Badge } from '@/components/core/Badge';

interface Props {
  name: string;
  description: string;
  isActive: boolean;
  saving: boolean;
  justSaved: boolean;
  canEdit: boolean;
  onSetActive: () => void;
  onSave: () => void;
  onEdit: () => void;
}

export function ContestDetailHeader({ name, description, isActive, saving, justSaved, canEdit, onSetActive, onSave, onEdit }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{name}</h1>
          {isActive && (
            <Badge>
              <Rocket className="h-3 w-3" />
              Active Contest
            </Badge>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button variant="secondary" icon={Pencil} onClick={onEdit} disabled={saving}>
            Edit Contest
          </Button>
        )}
        {!isActive && (
          <Button variant="positiveOutline" icon={Power} iconOnly tooltip="Set as Active Contest" onClick={onSetActive} disabled={saving} />
        )}
        <SaveButton saving={saving} justSaved={justSaved} idleLabel="Save Changes" disabled={saving} onClick={onSave} />
      </div>
    </div>
  );
}
