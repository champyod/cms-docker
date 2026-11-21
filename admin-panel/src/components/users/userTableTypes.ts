import type { ListSortInput } from '@/lib/list-sorting';
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
  initialSort?: ListSortInput;
}

export interface UserTableProps {
  users: UsersPageRow[];
  loading: boolean;
  selectedIds: Set<number>;
  permissionKeys: readonly string[];
  pageNumber: number;
  perPage: number;
  /** True when every row the filter matches is selected, not just the visible page. */
  allSelected: boolean;
  /** True when some but not all of the filtered rows are selected. */
  partlySelected: boolean;
  selectAllLabel: string;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
  onOpen: (user: UsersPageRow) => void;
  onEdit: (user: UsersPageRow) => void;
  onDelete: (id: number) => void;
  sort?: ListSortInput;
  onSortChange?: (sort: ListSortInput) => void;
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
  partlySelected: boolean;
  selectAllLabel: string;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
}
