import type { UsersPageRow } from '@/lib/prisma-selects';

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

export interface UserFormState {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  timezone: string;
  contestId: string;
  teamCode: string;
}

export const EMPTY_USER_FORM: UserFormState = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  password: '',
  timezone: DEFAULT_TIMEZONE,
  contestId: '',
  teamCode: '',
};

export function formFromUser(user: UsersPageRow): UserFormState {
  return {
    ...EMPTY_USER_FORM,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email ?? '',
    timezone: user.timezone ?? DEFAULT_TIMEZONE,
  };
}
