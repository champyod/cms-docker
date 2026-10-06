'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Plus, X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import type { OverrideEffect } from '@/lib/permission-engine';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import type { OverrideDraft } from './adminModalPersistence';

interface AdminAccessEditorProps {
  groups: GroupWithPermissions[];
  selectedGroupIds: number[];
  overrides: OverrideDraft[];
  loadingAccess: boolean;
  accessError: string;
  accessReason: string;
  effectivePermissions: ReadonlySet<string>;
  onSelectedGroupIdsChange: Dispatch<SetStateAction<number[]>>;
  onOverridesChange: Dispatch<SetStateAction<OverrideDraft[]>>;
  onAccessReasonChange: Dispatch<SetStateAction<string>>;
}

export function AdminAccessEditor({
  groups,
  selectedGroupIds,
  overrides,
  loadingAccess,
  accessError,
  accessReason,
  effectivePermissions,
  onSelectedGroupIdsChange,
  onOverridesChange,
  onAccessReasonChange,
}: AdminAccessEditorProps): React.JSX.Element {
  const handleGroupToggle = (groupId: number, checked: boolean) => {
    onSelectedGroupIdsChange((current) =>
      checked ? Array.from(new Set([...current, groupId])) : current.filter((id) => id !== groupId),
    );
  };

  const handleAddOverride = () => {
    const used = new Set(overrides.map((override) => override.permissionKey));
    const next = PERMISSION_REGISTRY.find((definition) => !used.has(definition.key));
    if (!next) return;
    onOverridesChange((current) => [...current, { permissionKey: next.key, effect: 'allow', reason: '' }]);
  };

  const handleOverrideKey = (index: number, permissionKey: string) => {
    onOverridesChange((current) =>
      current.map((override, position) => (position === index ? { ...override, permissionKey } : override)),
    );
  };

  const handleOverrideEffect = (index: number, effect: OverrideEffect) => {
    onOverridesChange((current) =>
      current.map((override, position) => (position === index ? { ...override, effect } : override)),
    );
  };

  const handleOverrideReason = (index: number, reason: string) => {
    onOverridesChange((current) =>
      current.map((override, position) => (position === index ? { ...override, reason } : override)),
    );
  };

  const handleRemoveOverride = (index: number) => {
    onOverridesChange((current) => current.filter((_, position) => position !== index));
  };

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground uppercase">Groups</span>
          {loadingAccess && <span className="text-xs text-muted-foreground">Loading…</span>}
        </div>
        {accessError && <p className="text-xs text-destructive">{accessError}</p>}
        <div className="space-y-2">
          {groups.map((group) => (
            <label
              key={group.id}
              className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg border border-border cursor-pointer"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground font-medium truncate">{group.name}</span>
                  {group.is_seeded && (
                    <span className="px-1.5 py-0.5 text-[0.625rem] rounded-full bg-muted text-muted-foreground">Seeded</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{group.description ?? 'No description'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
                  {group.permissionKeys.length}
                </span>
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(group.id)}
                  onChange={(event) => handleGroupToggle(group.id, event.target.checked)}
                  className="w-5 h-5 rounded accent-primary"
                />
              </div>
            </label>
          ))}
          {!loadingAccess && groups.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No groups are defined yet.</p>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground uppercase">Per-person overrides</span>
          <Button variant="secondary" size="sm" onClick={handleAddOverride}>
            <Plus className="w-4 h-4" />
            Add override
          </Button>
        </div>
        {overrides.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            This admin has no overrides — access matches their groups exactly.
          </p>
        )}
        {overrides.map((draft, index) => (
          <div
            key={`${draft.permissionKey}-${index}`}
            className="space-y-2 p-3 bg-muted/50 rounded-lg border border-border"
          >
            <div className="flex items-center gap-2">
              <select
                value={draft.permissionKey}
                onChange={(event) => handleOverrideKey(index, event.target.value)}
                className="flex-1 h-9 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {PERMISSION_REGISTRY.map((definition) => (
                  <option key={definition.key} value={definition.key}>
                    {definition.key}
                  </option>
                ))}
              </select>
              <select
                value={draft.effect}
                onChange={(event) => handleOverrideEffect(index, event.target.value as OverrideEffect)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                tooltip="Remove override"
                onClick={() => handleRemoveOverride(index)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <Input
              value={draft.reason}
              onChange={(event) => handleOverrideReason(index, event.target.value)}
              placeholder="Reason (required)"
            />
          </div>
        ))}
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground uppercase">Effective access</span>
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
            <ShieldCheck className="w-3 h-3" />
            {effectivePermissions.size} permissions
          </span>
        </div>
        <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1">
          {[...effectivePermissions].sort().map((key) => (
            <span key={key} className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground font-mono">
              {key}
            </span>
          ))}
          {effectivePermissions.size === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No effective permissions — this admin will be denied everything.
            </p>
          )}
        </div>
      </Card>

      <Input
        label="Reason for access changes"
        value={accessReason}
        onChange={(event) => onAccessReasonChange(event.target.value)}
        placeholder="e.g., onboarding, role change"
      />
    </>
  );
}
