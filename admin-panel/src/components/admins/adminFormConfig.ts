import type { AdminWithLogin } from '@/lib/prisma-selects';

export interface AdminFormState {
  name: string;
  username: string;
  password: string;
}

export const EMPTY_ADMIN_FORM: AdminFormState = {
  name: '',
  username: '',
  password: '',
};

export function formFromAdmin(admin: AdminWithLogin): AdminFormState {
  return {
    name: admin.name,
    username: admin.username,
    password: '',
  };
}

export function validateAdminForm(form: AdminFormState, isEdit: boolean): string {
  if (!form.name.trim() || !form.username.trim()) return 'Name and Username are required';
  if (!isEdit && !form.password.trim()) return 'Password is required for new admins';
  return '';
}
