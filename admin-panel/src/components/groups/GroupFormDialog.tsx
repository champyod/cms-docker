'use client';

import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import type { PermissionDefinition } from '@/lib/permission-registry';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import type { GroupsDict, GroupFormData } from './groupListTypes';

interface GroupFormDialogProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  selectedGroup: GroupWithPermissions | null;
  dict: GroupsDict;
  formData: GroupFormData;
  setFormData: Dispatch<SetStateAction<GroupFormData>>;
  groupedPermissions: Map<string, PermissionDefinition[]>;
  effectivePreview: ReadonlySet<string>;
  error: string;
  loading: boolean;
  onTogglePermission: (key: string, checked: boolean) => void;
  onToggleModule: (moduleKeys: readonly string[], checked: boolean) => void;
  onSave: () => void;
}

export function GroupFormDialog({
  open,
  setOpen,
  selectedGroup,
  dict,
  formData,
  setFormData,
  groupedPermissions,
  effectivePreview,
  error,
  loading,
  onTogglePermission,
  onToggleModule,
  onSave,
}: GroupFormDialogProps): React.JSX.Element {
  // Why a Set: every checkbox and both module aggregates probe the selection, so a
  // linear scan per probe is quadratic in the permission count.
  const selectedKeys = useMemo(
    () => new Set(formData.permissionKeys),
    [formData.permissionKeys],
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      title={selectedGroup ? dict.editGroup : dict.createGroup}
      className="max-w-2xl max-h-[85vh] overflow-y-auto"
    >
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <Input
          label={dict.name}
          value={formData.name}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder="e.g., Contest Managers"
        />
        <Input
          label={dict.description}
          value={formData.description}
          onChange={(e) =>
            setFormData((prev) => ({
              ...prev,
              description: e.target.value,
            }))
          }
          placeholder="Brief description of this group"
        />

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase">
              {dict.permissions}
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
              <ShieldCheck className="w-3 h-3" />
              {formData.permissionKeys.length} selected
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-3">
            {[...groupedPermissions.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([module, defs]) => {
                const allSelected = defs.every((d) => selectedKeys.has(d.key));
                const someSelected = defs.some((d) => selectedKeys.has(d.key));
                return (
                  <div key={module} className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              someSelected && !allSelected;
                        }}
                        onChange={(e) =>
                          onToggleModule(
                            defs.map((d) => d.key),
                            e.target.checked,
                          )
                        }
                        className="w-4 h-4 rounded accent-primary"
                      />
                      {module}
                    </label>
                    <div className="ml-6 grid grid-cols-2 gap-1">
                      {defs.map((def) => (
                        <label
                          key={def.key}
                          className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(def.key)}
                            onChange={(e) =>
                              onTogglePermission(
                                def.key,
                                e.target.checked,
                              )
                            }
                            className="w-3.5 h-3.5 rounded accent-primary"
                          />
                          {def.verb}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase">
              Effective permissions
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
              <ShieldCheck className="w-3 h-3" />
              {effectivePreview.size}
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1">
            {[...effectivePreview].sort().map((key) => (
              <span
                key={key}
                className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground font-mono"
              >
                {key}
              </span>
            ))}
            {effectivePreview.size === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No permissions selected.
              </p>
            )}
          </div>
        </Card>

        <Input
          label="Reason"
          value={formData.reason}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, reason: e.target.value }))
          }
          placeholder={dict.reasonPlaceholder}
        />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {dict.cancel}
          </Button>
          <Button variant="positive" onClick={onSave} loading={loading}>
            {dict.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
