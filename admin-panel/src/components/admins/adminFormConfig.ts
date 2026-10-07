import type { AdminWithLogin } from '@/lib/prisma-selects';

// Why: every key here must exist in FIELD_PERMISSION_MAP['admins'] — the permission map gates
// visibility and editability per field; stale keys would pass unchecked through stripDisallowedFields.
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
