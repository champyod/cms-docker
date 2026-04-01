import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

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

    const where = search
      ? {
          OR: [
            { first_name: { contains: search, mode: 'insensitive' as const } },
            { last_name: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { participations: { some: { teams: { code: { contains: search, mode: 'insensitive' as const } } } } },
            { participations: { some: { teams: { name: { contains: search, mode: 'insensitive' as const } } } } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { id: 'asc' },
        include: {
          participations: {
            select: {
              teams: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
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
  } catch (error: any) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const { first_name, last_name, username, email, password, timezone } = data;

    if (!password) return apiError({ message: 'Password is required', status: 400 });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const storedPassword = `bcrypt:${hash}`;

    const user = await prisma.users.create({
      data: {
        first_name,
        last_name,
        username,
        email: email || null,
        password: storedPassword,
        timezone: timezone || null,
        preferred_languages: [],
      },
    });

    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ user });
  } catch (error: any) {
    if (error.code === 'P2002') return apiError({ message: 'Username already exists', status: 400 });
    return apiError(error);
  }
}
