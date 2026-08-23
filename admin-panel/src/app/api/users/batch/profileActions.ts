import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess } from '@/lib/api-utils';
import type { BatchActionRequest } from './credentialActions';

const PROFILE_MODES = ['timezone', 'email-domain', 'clear-email'] as const;
const EMAIL_DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function handleProfile({ body, userIds }: BatchActionRequest) {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = PROFILE_MODES.find((candidate) => candidate === body.mode);
  if (!mode) {
    return apiError({ message: 'Invalid profile mode', status: 400 });
  }

  if (mode === 'timezone') {
    return applyTimezone(body, userIds);
  }

  if (mode === 'clear-email') {
    return applyClearEmail(userIds);
  }

  return applyEmailDomain(body, userIds);
}

async function applyTimezone(body: Record<string, unknown>, userIds: number[]) {
  const timezone = String(body.timezone || '').trim();
  if (!timezone) {
    return apiError({ message: 'timezone is required', status: 400 });
  }

  const result = await prisma.users.updateMany({
    where: { id: { in: userIds } },
    data: { timezone },
  });

  revalidatePath('/[locale]/users', 'page');
  return apiSuccess({ success: true, updatedCount: result.count });
}

async function applyClearEmail(userIds: number[]) {
  const result = await prisma.users.updateMany({
    where: { id: { in: userIds } },
    data: { email: null },
  });

  revalidatePath('/[locale]/users', 'page');
  return apiSuccess({ success: true, updatedCount: result.count });
}

async function applyEmailDomain(body: Record<string, unknown>, userIds: number[]) {
  const emailDomain = String(body.emailDomain || '').trim().toLowerCase();
  if (!emailDomain || !EMAIL_DOMAIN_PATTERN.test(emailDomain)) {
    return apiError({ message: 'Valid emailDomain is required', status: 400 });
  }

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, email: true },
  });

  let updatedCount = 0;
  for (const user of users) {
    const localPart = (user.email?.split('@')[0] || user.username).trim();
    await prisma.users.update({
      where: { id: user.id },
      data: { email: `${localPart}@${emailDomain}` },
    });
    updatedCount += 1;
  }

  revalidatePath('/[locale]/users', 'page');
  return apiSuccess({ success: true, updatedCount });
}
