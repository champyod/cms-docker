'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import { Badge } from '@/components/core/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import { useToast } from '@/components/providers/ToastProvider';
import {
  hasEffectivePermission,
  resolveEffectivePermissions,
} from '@/lib/permission-engine';
import {
  PERMISSION_REGISTRY,
  type PermissionDefinition,
} from '@/lib/permission-registry';
import { createGroup, updateGroup, deleteGroup } from '@/app/actions/groups';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';

interface GroupsDict {
  title: string;
  subtitle: string;
  createGroup: string;
  editGroup: string;
  name: string;
  description: string;
  isSeeded: string;
  permissions: string;
  save: string;
  cancel: string;
  reasonPlaceholder: string;
  deleteConfirm: string;
  noGroups: string;
  noGroupsDescription: string;
  deleteTooltip: string;
  editTooltip: string;
}

interface GroupListProps {
  groups: GroupWithPermissions[];
  permissionKeys: readonly string[];
  dict: GroupsDict;
}

interface GroupFormData {
  name: string;
  description: string;
  permissionKeys: string[];
  reason: string;
}

const EMPTY_FORM: GroupFormData = {
  name: '',
  description: '',
  permissionKeys: [],
  reason: '',
};

function groupPermissionsByModule(): Map<string, PermissionDefinition[]> {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const def of PERMISSION_REGISTRY) {
    const list = grouped.get(def.module);
    if (list) {
      list.push(def);
    } else {
      grouped.set(def.module, [def]);
    }
  }
  return grouped;
}

export function GroupList({
  groups,
  permissionKeys,
  dict,
}: GroupListProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const effective = useMemo(
    () => new Set(permissionKeys),
    [permissionKeys],
  );

  const canCreate = hasEffectivePermission(effective, 'group:create');
  const canUpdate = hasEffectivePermission(effective, 'group:update');
  const canDelete = hasEffectivePermission(effective, 'group:delete');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] =
    useState<GroupWithPermissions | null>(null);
  const [formData, setFormData] = useState<GroupFormData>(EMPTY_FORM);
  const [deleteReason, setDeleteReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const groupedPermissions = useMemo(
    () => groupPermissionsByModule(),
    [],
  );

  // Why: preview is derived from selected permission keys with no overrides, so it updates instantly while editing.
  const effectivePreview = useMemo(
    () => resolveEffectivePermissions(formData.permissionKeys, []),
    [formData.permissionKeys],
  );

  const handleOpenCreate = useCallback(() => {
    setSelectedGroup(null);
    setFormData(EMPTY_FORM);
    setError('');
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback(
    (group: GroupWithPermissions) => {
      setSelectedGroup(group);
      setFormData({
        name: group.name,
        description: group.description ?? '',
        permissionKeys: [...group.permissionKeys],
        reason: '',
      });
      setError('');
      setIsModalOpen(true);
    },
    [],
  );

  const handleOpenDelete = useCallback(
    (group: GroupWithPermissions) => {
      setSelectedGroup(group);
      setDeleteReason('');
      setError('');
      setIsDeleteOpen(true);
    },
    [],
  );

  const handleTogglePermission = useCallback(
    (key: string, checked: boolean) => {
      setFormData((prev) => ({
        ...prev,
        permissionKeys: checked
          ? [...prev.permissionKeys, key]
          : prev.permissionKeys.filter((k) => k !== key),
      }));
    },
    [],
  );

  const handleToggleModule = useCallback(
    (moduleKeys: readonly string[], checked: boolean) => {
      setFormData((prev) => {
        const current = new Set(prev.permissionKeys);
        for (const key of moduleKeys) {
          if (checked) current.add(key);
          else current.delete(key);
        }
        return { ...prev, permissionKeys: Array.from(current) };
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) {
      setError('Group name is required');
      return;
    }
    if (!formData.reason.trim()) {
      setError('A reason is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = selectedGroup
        ? await updateGroup(
            selectedGroup.id,
            formData.name,
            formData.description,
            formData.permissionKeys,
            formData.reason,
          )
        : await createGroup(
            formData.name,
            formData.description,
            formData.permissionKeys,
            formData.reason,
          );

      if (!result.success) {
        setError(result.error);
        return;
      }

      toast.addToast({
        type: 'success',
        title: selectedGroup ? 'Group updated' : 'Group created',
      });
      setIsModalOpen(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Operation failed',
      );
    } finally {
      setLoading(false);
    }
  }, [formData, selectedGroup, router, toast]);

  const handleDelete = useCallback(async () => {
    if (!selectedGroup) return;
    if (!deleteReason.trim()) {
      setError('A reason is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await deleteGroup(selectedGroup.id, deleteReason);
      if (!result.success) {
        setError(result.error);
        return;
      }

      toast.addToast({ type: 'success', title: 'Group deleted' });
      setIsDeleteOpen(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Delete failed',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedGroup, deleteReason, router, toast]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <Text variant="h2">{dict.title}</Text>
        {canCreate && (
          <Button variant="positive" icon={Plus} onClick={handleOpenCreate}>
            {dict.createGroup}
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{dict.name}</TableHead>
            <TableHead>{dict.description}</TableHead>
            <TableHead>{dict.isSeeded}</TableHead>
            <TableHead>{dict.permissions}</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                {dict.noGroups}
              </TableCell>
            </TableRow>
          ) : (
            groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {group.description ?? '—'}
                </TableCell>
                <TableCell>
                  {group.is_seeded && (
                    <Badge variant="cyan">{dict.isSeeded}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
                    {group.permissionKeys.length}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        iconOnly
                        tooltip={dict.editTooltip}
                        onClick={() => handleOpenEdit(group)}
                      />
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        iconOnly
                        tooltip={dict.deleteTooltip}
                        onClick={() => handleOpenDelete(group)}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsModalOpen(false);
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
                  const allSelected = defs.every((d) =>
                    formData.permissionKeys.includes(d.key),
                  );
                  const someSelected = defs.some((d) =>
                    formData.permissionKeys.includes(d.key),
                  );
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
                            handleToggleModule(
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
                              checked={formData.permissionKeys.includes(
                                def.key,
                              )}
                              onChange={(e) =>
                                handleTogglePermission(
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
            <Button
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
            >
              {dict.cancel}
            </Button>
            <Button
              variant="positive"
              onClick={handleSave}
              loading={loading}
            >
              {dict.save}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setIsDeleteOpen(false);
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
            <Button
              variant="secondary"
              onClick={() => setIsDeleteOpen(false)}
            >
              {dict.cancel}
            </Button>
            <Button
              variant="negative"
              onClick={handleDelete}
              loading={loading}
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
