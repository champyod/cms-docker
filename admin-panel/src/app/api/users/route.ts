import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { buildUserSearchWhere, safeUserSelect, usersPageSelect } from '@/lib/prisma-selects';
import { formatStoredPassword, isPasswordKind, DEFAULT_PASSWORD_KIND } from '@/lib/password-format';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

const DEFAULT_USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;

export async function GET(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const searchParams = req.nextUrl.searchParams;
    const page = Math.max(Number(searchParams.get('page')) || 1, 1);
    const perPage = Math.min(Math.max(Number(searchParams.get('perPage')) || DEFAULT_USERS_PER_PAGE, 1), MAX_USERS_PER_PAGE);
    const search = (searchParams.get('search') || '').trim();
    const skip = (page - 1) * perPage;

    const where = buildUserSearchWhere(search);

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { id: 'asc' },
        select: usersPageSelect,
      }),
      prisma.users.count({ where }),
    ]);

    return apiSuccess({
      users,
      total,
      totalPages: Math.max(Math.ceil(total / perPage), 1),
      currentPage: page,
      perPage,
      search,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const { first_name, last_name, username, email, password, timezone } = data;

    const usernameTrimmed = typeof username === 'string' ? username.trim() : '';
    const firstNameTrimmed = typeof first_name === 'string' ? first_name.trim() : '';
    const lastNameTrimmed = typeof last_name === 'string' ? last_name.trim() : '';
    if (!usernameTrimmed) return apiError({ message: 'Username is required', status: 400 });
    if (!/^[A-Za-z0-9_.-]+$/.test(usernameTrimmed)) return apiError({ message: 'Username must contain only letters, numbers, dot, hyphen and underscore', status: 400 });
    if (!firstNameTrimmed) return apiError({ message: 'First name is required', status: 400 });
    if (!lastNameTrimmed) return apiError({ message: 'Last name is required', status: 400 });
    if (email && typeof email === 'string' && email.trim().length > 0) {
      const emailTrimmed = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) return apiError({ message: 'Invalid email format', status: 400 });
    }
    if (!password) return apiError({ message: 'Password is required', status: 400 });
    if (typeof password !== 'string' || password.length < 4) return apiError({ message: 'Password must be at least 4 characters', status: 400 });

    const passwordKind = isPasswordKind(data.passwordKind) ? data.passwordKind : DEFAULT_PASSWORD_KIND;
    const storedPassword = await formatStoredPassword(passwordKind, password);

    const created = await prisma.users.create({
      data: {
        first_name: firstNameTrimmed,
        last_name: lastNameTrimmed,
        username: usernameTrimmed,
        email: typeof email === 'string' && email.trim().length > 0 ? email.trim() : null,
        password: storedPassword,
        timezone: typeof timezone === 'string' && timezone.trim().length > 0 ? timezone.trim() : null,
        preferred_languages: [],
      },
    });

    const user = await prisma.users.findUnique({ where: { id: created.id }, select: safeUserSelect });

    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ user });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') return apiError({ message: 'Username already exists', status: 400 });
    return apiError(error);
  }
}
