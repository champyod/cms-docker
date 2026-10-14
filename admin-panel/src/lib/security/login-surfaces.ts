import { prisma } from '@/lib/prisma';

export interface LoginSurface {
  readonly id: number;
  readonly key: string;
  readonly label: string;
}

/**
 * The seeded login faces, in id order. An attempt carries only its surface key, so
 * the panel resolves the operator label from here rather than hardcoding one per
 * face — a new face is a row, not a code branch.
 */
export async function listLoginSurfaces(): Promise<LoginSurface[]> {
  return prisma.login_surfaces.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, key: true, label: true },
  });
}

/** The label for each surface key, for a client that only sees an attempt's key. */
export function surfaceLabels(
  surfaces: readonly LoginSurface[],
): ReadonlyMap<string, string> {
  return new Map(surfaces.map((surface) => [surface.key, surface.label]));
}
