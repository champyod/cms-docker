'use client';

import { Check, Save, Rocket, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/core/Button';
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
  const saveButton = (
    <Button variant="positive" icon={justSaved ? Check : Save} onClick={onSave} loading={saving} disabled={saving}>
      {saving ? 'Saving...' : justSaved ? 'Saved' : 'Save Changes'}
    </Button>
  );
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
        {justSaved && !saving ? (
          <motion.span
            key="saved"
            initial={{ scale: 0.9, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            className="inline-flex"
          >
            {saveButton}
          </motion.span>
        ) : saveButton}
      </div>
    </div>
  );
}
