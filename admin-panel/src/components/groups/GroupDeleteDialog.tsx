'use client';

import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import type { GroupsDict } from './groupListTypes';

interface GroupDeleteDialogProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  dict: GroupsDict;
  error: string;
  deleteReason: string;
  setDeleteReason: Dispatch<SetStateAction<string>>;
  loading: boolean;
  onDelete: () => void;
}

export function GroupDeleteDialog({
  open,
  setOpen,
  dict,
  error,
  deleteReason,
  setDeleteReason,
  loading,
  onDelete,
}: GroupDeleteDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      title="Delete Group"
      description={dict.deleteConfirm}
      className="max-w-md"
    >
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <Input
          label="Reason"
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          placeholder={dict.reasonPlaceholder}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {dict.cancel}
          </Button>
          <Button variant="negative" onClick={onDelete} loading={loading}>
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
