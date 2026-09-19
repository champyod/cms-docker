'use client';

import { Save, Rocket, Pencil } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Badge } from '@/components/core/Badge';

interface Props {
  name: string;
  description: string;
  isActive: boolean;
  saving: boolean;
  canEdit: boolean;
  onSetActive: () => void;
  onSave: () => void;
  onEdit: () => void;
}

export function ContestDetailHeader({ name, description, isActive, saving, canEdit, onSetActive, onSave, onEdit }: Props) {
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
          <Button variant="positiveOutline" icon={Rocket} onClick={onSetActive} disabled={saving}>
            Set as Active Contest
          </Button>
        )}
        <Button variant="positive" icon={Save} onClick={onSave} loading={saving} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
