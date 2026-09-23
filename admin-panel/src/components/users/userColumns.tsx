import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn, ResponsiveRowProps } from '@/components/core/ResponsiveTable';
import type { UsersPageRow } from '@/lib/prisma-selects';
import type { BuildUserColumnsArgs, UserRow } from './userTableTypes';

export const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

function teamCodes(user: UsersPageRow): string {
  const codes = (user.participations || [])
    .map((participation: UsersPageRow['participations'][number]) => participation?.teams?.code)
    .filter(Boolean);
  return Array.from(new Set(codes)).join(', ') || '-';
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
export function buildUserColumns(args: BuildUserColumnsArgs): ResponsiveColumn<UserRow>[] {
  const { selectedIds, allSelected, onToggleAll, onToggleOne } = args;
  return [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          title="Select all users"
          className={CHECKBOX_CLASS}
          checked={allSelected}
          onChange={(event) => onToggleAll(event.target.checked)}
        />
      ),
      render: ({ user }) => (
        <input
          type="checkbox"
          title={`Select user ${user.id}`}
          className={CHECKBOX_CLASS}
          checked={selectedIds.has(user.id)}
          onChange={(event) => onToggleOne(user.id, event.target.checked)}
        />
      ),
      hideOnMobile: true,
    },
    {
      key: 'position',
      header: '#',
      render: ({ position }) => (
        <span className="font-mono text-muted-foreground text-xs">#{position}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'name',
      header: 'Name',
      render: ({ user }) => (
        <span className="font-medium">{user.first_name} {user.last_name}</span>
      ),
    },
    {
      key: 'username',
      header: 'Username',
      render: ({ user }) => <span>{user.username}</span>,
    },
    {
      key: 'team',
      header: 'Team',
      render: ({ user }) => <span>{teamCodes(user)}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: ({ user }) => (
        <span className="text-muted-foreground">{user.email || '-'}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'id',
      header: 'ID',
      render: ({ user }) => (
        <span className="font-mono text-muted-foreground text-xs">#{user.id}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: ({ user }) =>
        user.status ? (
          <Badge variant={user.status === 'active' ? 'success' : 'warning'}>{user.status}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'organization',
      header: 'Organization',
      render: ({ user }) => <span>{user.organization ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'country',
      header: 'Country',
      render: ({ user }) => <span>{user.country ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'contests',
      header: 'Contests',
      render: ({ user }) => <span>{user._count?.participations ?? 0}</span>,
    },
  ];
}

// Why: j/k navigation queries [data-shortcut-row]; without this prop
// the migrated users list is invisible to the shortcut handler.
export function getUserRowProps(row: UserRow): ResponsiveRowProps {
  return { 'data-shortcut-row': row.user.id, className: 'cursor-pointer' };
}
