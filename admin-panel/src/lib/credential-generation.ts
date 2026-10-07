import { prisma } from '@/lib/prisma';
import { randomToken } from '@/lib/creds-file';

export const USERNAME_RANDOM_SUFFIX_LENGTH = 4;

export const MAX_USERNAME_GENERATION_ATTEMPTS = 100;

const USERNAME_BASE_MAX_LENGTH = 20;

const GENERATED_PASSWORD_LENGTH = 14;

export function makeUsername(firstName: string, lastName: string): string {
  const firstAscii: string = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii: string = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const base: string = (`${firstAscii}${lastAscii}` || 'user').slice(0, USERNAME_BASE_MAX_LENGTH);
  return `${base}${randomToken(USERNAME_RANDOM_SUFFIX_LENGTH).toLowerCase()}`;
}

export function makePassword(): string {
  return randomToken(GENERATED_PASSWORD_LENGTH);
}

export async function ensureUniqueUsername(
  firstName: string,
  lastName: string,
  localSet: Set<string>
): Promise<string> {
  for (let attempt = 0; attempt < MAX_USERNAME_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate: string = makeUsername(firstName, lastName);
    if (localSet.has(candidate)) {
      continue;
    }

    const existing = await prisma.users.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!existing) {
      localSet.add(candidate);
      return candidate;
    }
  }

  throw new Error('Unable to generate unique username');
}
