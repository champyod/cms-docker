import type { AdminWithLogin } from '@/lib/prisma-selects';

export type PermissionFlagKey = Exclude<
  keyof AdminWithLogin,
  'id' | 'username' | 'name' | 'enabled' | 'last_login_at'
>;

export interface AdminFormState {
  name: string;
  username: string;
  password: string;
  permission_all: boolean;
  permission_messaging: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
}

export const EMPTY_ADMIN_FORM: AdminFormState = {
  name: '',
  username: '',
  password: '',
  permission_all: false,
  permission_messaging: true,
  permission_tasks: false,
  permission_users: false,
  permission_contests: false,
};

export const ROLE_PRESETS: Record<'superadmin' | 'committee', Pick<AdminFormState, PermissionFlagKey>> = {
  superadmin: {
    permission_all: true,
    permission_messaging: true,
    permission_tasks: true,
    permission_users: true,
    permission_contests: true,
  },
  committee: {
    permission_all: false,
    permission_messaging: true,
    permission_tasks: true,
    permission_users: false,
    permission_contests: true,
  },
};

export const PERMISSION_CHECKBOXES = [
  { key: 'permission_messaging', label: 'Messaging', description: 'View/reply to questions and announcements' },
  { key: 'permission_tasks', label: 'Task Management', description: 'Can view and customize tasks' },
  { key: 'permission_contests', label: 'Contest Management', description: 'Can view and edit basic contest settings' },
  { key: 'permission_users', label: 'User Management (Participants)', description: 'Can manage contestants and participations' },
] as const satisfies ReadonlyArray<{ key: PermissionFlagKey; label: string; description: string }>;

export function formFromAdmin(admin: AdminWithLogin): AdminFormState {
  return {
    name: admin.name,
    username: admin.username,
    password: '',
    permission_all: admin.permission_all,
    permission_messaging: admin.permission_messaging,
    permission_tasks: admin.permission_tasks,
    permission_users: admin.permission_users,
    permission_contests: admin.permission_contests,
  };
}

export function validateAdminForm(form: AdminFormState, isEdit: boolean): string {
  if (!form.name.trim() || !form.username.trim()) return 'Name and Username are required';
  if (!isEdit && !form.password.trim()) return 'Password is required for new admins';
  return '';
}
