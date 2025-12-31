import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

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
