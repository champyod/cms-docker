import { SHOWN_KIND } from '@/lib/ranking-config';
import { prisma } from '@/lib/prisma';

/**
 * The one contest the board shows, resolved from the config that decides it.
 *
 * WHY the config and not a settings column: `ranking_config` is the board's whole answer for what
 * it draws, so any other place naming a contest is a second thing to keep in step — and that
 * second place is exactly what made the appearance form look like it picked the board while the
 * reader ignored it. The reader words a header only for the one contest the config shows, and this
 * answers the same question the same way: none for no target, none for several, so a caller never
 * words a heading for a contest the operator did not choose.
 *
 * WHY a key the reader could not draw answers as none rather than throwing: this is a read a page
 * renders, and the board itself is where an undrawable declaration is refused, where an operator
 * can see it.
 */
export async function readShownContestId(): Promise<number | null> {
  const rows = await prisma.ranking_config.findMany({
    where: { active: true },
    select: { target_kind: true, target_key: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const [only] = rows;
  if (rows.length !== 1 || only.target_kind !== SHOWN_KIND) return null;
  const parsed = Number.parseInt(only.target_key, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
