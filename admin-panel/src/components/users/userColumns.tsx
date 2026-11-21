import { Badge } from '@/components/core/Badge';
import { CellText } from '@/components/core/CellText';
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
  const { selectedIds, allSelected, partlySelected, selectAllLabel, onToggleAll, onToggleOne } = args;
  return [
    {
      key: 'select',
      // Why the indeterminate state: the header cell selects every row the filter matches, so a
      // partial selection has to read as partial rather than as "nothing selected".
      header: (
        <input
          type="checkbox"
          title={selectAllLabel}
          aria-label={selectAllLabel}
          className={CHECKBOX_CLASS}
          checked={allSelected}
          ref={(node) => { if (node !== null) node.indeterminate = partlySelected && !allSelected; }}
          onChange={(event) => onToggleAll(event.target.checked)}
        />
      ),
      cellClassName: 'w-10',
      render: ({ user }) => (
        <span onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            title={`Select user ${user.id}`}
            className={CHECKBOX_CLASS}
            checked={selectedIds.has(user.id)}
            onChange={(event) => onToggleOne(user.id, event.target.checked)}
          />
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'position',
      header: '#',
      cellClassName: 'w-12',
      render: ({ position }) => (
        <CellText width="id" mono muted>#{position}</CellText>
      ),
      hideOnMobile: true,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      cellClassName: 'min-w-[140px]',
      render: ({ user }) => (
        <CellText width="lg" bold>{user.first_name} {user.last_name}</CellText>
      ),
    },
    {
      key: 'username',
      header: 'Username',
      sortKey: 'username',
      cellClassName: 'min-w-[100px]',
      render: ({ user }) => <CellText width="md" mono>{user.username}</CellText>,
    },
    {
      key: 'team',
      header: 'Team',
      cellClassName: 'min-w-[80px]',
      render: ({ user }) => <CellText width="sm" muted>{teamCodes(user)}</CellText>,
    },
    {
      key: 'email',
      header: 'Email',
      sortKey: 'email',
      cellClassName: 'min-w-[160px]',
      render: ({ user }) => (
        <CellText width="xl" muted>{user.email || '-'}</CellText>
      ),
      hideOnMobile: true,
    },
    {
      key: 'id',
      header: 'ID',
      sortKey: 'id',
      cellClassName: 'w-16',
      render: ({ user }) => (
        <CellText width="id" mono muted>#{user.id}</CellText>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cellClassName: 'w-24',
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
      sortKey: 'organization',
      cellClassName: 'min-w-[120px]',
      render: ({ user }) => <CellText width="md" muted>{user.organization ?? '—'}</CellText>,
      hideOnMobile: true,
    },
    {
      key: 'country',
      header: 'Country',
      sortKey: 'country',
      cellClassName: 'min-w-[80px]',
      render: ({ user }) => <CellText width="sm" muted>{user.country ?? '—'}</CellText>,
      hideOnMobile: true,
    },
    {
      key: 'contests',
      header: 'Contests',
      sortKey: 'contests',
      cellClassName: 'w-20 text-center',
      render: ({ user }) => (
        <CellText width="id" mono muted className="text-center">
          {user._count?.participations ?? 0}
        </CellText>
      ),
    },
  ];
}

// Why: j/k navigation queries [data-shortcut-row]; without this prop
// the migrated users list is invisible to the shortcut handler.
// Row click opens the record for every readable row; the select checkbox and
// the action buttons stop propagation themselves, because a click on a cell
// always reports that cell as the target rather than the row. Keyboard focus
// lands on the row itself, so the key handler still requires the row target.
// A row stripped of `id` stays non-navigable instead of exposing an identifier
// the caller may not read.
export function getUserRowProps(
  row: UserRow,
  onOpen: (user: UserRow['user']) => void,
): ResponsiveRowProps {
  if (typeof row.user.id !== 'number') return { 'data-shortcut-row': 0, className: 'cursor-pointer' };
  return {
    'data-shortcut-row': row.user.id,
    className: 'cursor-pointer',
    tabIndex: 0,
    onClick: () => onOpen(row.user),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(row.user);
    },
  };
}
