import type { Dictionary } from '@/lib/dictionary';
import type { UsersPageRow } from '@/lib/prisma-selects';

export interface UserListProps {
  initialUsers: UsersPageRow[];
  totalPages: number;
  currentPage: number;
  perPage: number;
  initialSearch: string;
  contests: Array<{ id: number; name: string }>;
  canReadContests: boolean;
  navigation: Dictionary['navigation'];
  permissionKeys: readonly string[];
  locale: 'en' | 'th';
}

export interface UserTableProps {
  users: UsersPageRow[];
  loading: boolean;
  selectedIds: Set<number>;
  canManageUsers: boolean;
  pageNumber: number;
  perPage: number;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
  onOpen: (user: UsersPageRow) => void;
  onEdit: (user: UsersPageRow) => void;
  onDelete: (id: number) => void;
}

// Why: position is precomputed so the shared column model stays a pure
// row-to-node map without needing a row index at render time.
export interface UserRow {
  user: UsersPageRow;
  position: number;
}

export interface BuildUserColumnsArgs {
  selectedIds: Set<number>;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
}
