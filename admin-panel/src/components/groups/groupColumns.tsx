import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import type { GroupsDict } from './groupListTypes';

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
export function buildColumns(
  dict: GroupsDict,
): ResponsiveColumn<GroupWithPermissions>[] {
  return [
    {
      key: 'name',
      header: dict.name,
      render: (group) => <span className="font-medium">{group.name}</span>,
    },
    {
      key: 'description',
      header: dict.description,
      render: (group) => (
        <span className="block max-w-xs truncate">
          {group.description ?? '—'}
        </span>
      ),
    },
    {
      key: 'isSeeded',
      header: dict.isSeeded,
      render: (group) =>
        group.is_seeded ? (
          <Badge variant="cyan">{dict.isSeeded}</Badge>
        ) : null,
    },
    {
      key: 'permissions',
      header: dict.permissions,
      render: (group) => (
        <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
          {group.permissionKeys.length}
        </span>
      ),
    },
  ];
}
