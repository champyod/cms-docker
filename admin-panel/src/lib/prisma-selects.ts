import type { Prisma } from '@prisma/client';

export const safeUserSelect = {
  id: true,
  username: true,
  first_name: true,
  last_name: true,
  email: true,
  timezone: true,
  preferred_languages: true,
} satisfies Prisma.usersSelect;

export const safeAdminSelect = {
  id: true,
  username: true,
  name: true,
  enabled: true,
  permission_all: true,
  permission_messaging: true,
  permission_tasks: true,
  permission_users: true,
  permission_contests: true,
} satisfies Prisma.adminsSelect;

export type SafeUser = Prisma.usersGetPayload<{ select: typeof safeUserSelect }>;

export type SafeAdmin = Prisma.adminsGetPayload<{ select: typeof safeAdminSelect }>;

export type AdminWithLogin = Prisma.adminsGetPayload<{
  select: typeof safeAdminSelect & { last_login_at: true };
}>;
