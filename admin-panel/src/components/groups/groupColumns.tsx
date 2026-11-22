import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import type { GroupsDict } from './groupListTypes';

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
export function buildColumns(
  dict: GroupsDict,
  missing: string,
): ResponsiveColumn<GroupWithPermissions>[] {
  return [
    {
      key: 'name',
      header: dict.name,
      sortKey: 'name',
      render: (group) => <span className="font-medium">{group.name}</span>,
    },
    {
      key: 'description',
      header: dict.description,
      sortKey: 'description',
      render: (group) => (
        <span className="block max-w-xs truncate">
          {group.description ?? missing}
        </span>
      ),
    },
    {
      key: 'isSeeded',
      header: dict.isSeeded,
      sortKey: 'is_seeded',
      render: (group) =>
        group.is_seeded ? (
          <Badge variant="cyan">{dict.isSeeded}</Badge>
        ) : null,
    },
    {
      key: 'permissions',
      header: dict.permissions,
      sortKey: 'permissions',
      render: (group) => (
        <Badge variant="indigo">{group.permissionKeys.length}</Badge>
      ),
    },
  ];
}
