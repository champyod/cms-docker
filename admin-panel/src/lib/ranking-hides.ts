import { loadActorNames } from '@/lib/admin-names';
import { prisma } from '@/lib/prisma';
import type { AttributedRow } from '@/lib/ranking-attribution';
import { keySpellings } from '@/lib/ranking-projection';

/**
 * What one shard's board drops, and where each hide came from.
 *
 * WHY this surface exists: a row leaves the board through two different writes. The panel files an
 * override row with `action = 'hide'`, and the contest data can mark a participation hidden — a
 * flag set by the classic admin, an import or a script — which the projection mirrors as a
 * `ranking_hidden` tombstone. Only the override rows are listed today, so the tombstones are
 * invisible, and a hide that names something the projection does not hold is invisible too: the
 * row applies to nothing and nothing says so. Both are the same operator question — "what is the
 * board hiding, and who hid it" — so they are answered on one surface rather than three.
 *
 * WHY read the projection rather than the override table's own columns: what a hide actually
 * removes is decided by the rows the board draws, so a hide whose target the projection no longer
 * carries has to read as naming nothing instead of as a healthy row.
 */

/** One hide as a recorded row: an override the panel or the CLI filed. */
export interface HideOverrideRow extends AttributedRow {
  readonly targetKind: string;
  readonly targetKey: string;
  readonly reason: string | null;
}

/**
 * Where one hide came from.
 *
 * A participation flag carries no author by construction — the contest data records the flag, not
 * who set it — so the two sources are a union rather than one shape with two nullable halves: an
 * override row can be attributed, a tombstone cannot.
 */
export type RankingHideSource =
  | {
      readonly source: 'override';
      readonly reason: string | null;
      readonly createdBy: number | null;
      readonly createdByName: string | null;
    }
  | { readonly source: 'participation' };

/** One row the board is hiding, with every writer that hides it. */
export interface RankingHide {
  readonly id: string;
  readonly targetKind: string;
  readonly targetKey: string;
  /** The projection's own name for the target, or `null` when it holds no such row. */
  readonly label: string | null;
  readonly sources: readonly RankingHideSource[];
}

/** The names the board knows, keyed the way the projection stores each kind. */
export interface HideProjection {
  readonly users: ReadonlyMap<string, string>;
  readonly teams: ReadonlyMap<string, string>;
  readonly tasks: ReadonlyMap<string, string>;
  readonly contests: ReadonlyMap<string, string>;
}

/** A task key is the composite `<encodedContest>/<encodedTaskName>`; a bare key is the older spelling. */
function taskKeyPart(targetKey: string): string {
  const cut = targetKey.indexOf('/');
  return cut === -1 ? targetKey : targetKey.slice(cut + 1);
}

interface ResolvedTarget {
  /** The key the projection files this target under, which is also the hide's identity. */
  readonly identity: string;
  readonly label: string;
}

function fromMap(map: ReadonlyMap<string, string>, key: string): ResolvedTarget | null {
  for (const candidate of keySpellings(key)) {
    const label = map.get(candidate);
    if (label !== undefined) return { identity: candidate, label };
  }
  return null;
}

function resolveTarget(
  targetKind: string,
  targetKey: string,
  projection: HideProjection,
): ResolvedTarget | null {
  if (targetKind === 'user') return fromMap(projection.users, targetKey);
  if (targetKind === 'team') return fromMap(projection.teams, targetKey);
  if (targetKind === 'contest') return fromMap(projection.contests, targetKey);
  if (targetKind === 'task') return fromMap(projection.tasks, taskKeyPart(targetKey));
  // The whole-board target names no row: `*` is the board itself, so there is nothing to resolve.
  return null;
}

/**
 * The board's hides, one row per hidden thing, with every source on it.
 *
 * WHY the merged row and not one line per recorded write: the same user can be hidden by an
 * override row and by a participation flag at once, and listing that as two lines hides the fact
 * that ending one of them changes nothing — the operator has to see both statements on one line to
 * know which one to end.
 */
export function describeHides(
  overrides: readonly HideOverrideRow[],
  tombstones: readonly string[],
  projection: HideProjection,
): RankingHide[] {
  const hides = new Map<string, { targetKind: string; targetKey: string; label: string | null; sources: RankingHideSource[] }>();
  const add = (targetKind: string, targetKey: string, source: RankingHideSource): void => {
    // WHY the projection's key as identity when it resolves: a tombstone is always encoded while an
    // override may carry the operator's own spelling, so keying on what was written would list the
    // same hidden row twice. The projection's key is the board's answer for the same row.
    const resolved = resolveTarget(targetKind, targetKey, projection);
    const id = `${targetKind}:${resolved?.identity ?? targetKey}`;
    const existing = hides.get(id);
    if (existing !== undefined) {
      existing.sources.push(source);
      return;
    }
    hides.set(id, { targetKind, targetKey, label: resolved?.label ?? null, sources: [source] });
  };

  for (const row of overrides) {
    add(row.targetKind, row.targetKey, {
      source: 'override',
      reason: row.reason,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
    });
  }
  for (const key of tombstones) add('user', key, { source: 'participation' });

  return [...hides.entries()]
    .map(([id, hide]) => ({ id, ...hide }))
    .sort((left, right) =>
      left.targetKind === right.targetKind
        ? left.targetKey.localeCompare(right.targetKey)
        : left.targetKind.localeCompare(right.targetKind),
    );
}

async function readKeys<Row>(
  keys: ReadonlySet<string>,
  read: (keys: string[]) => Promise<Row[]>,
): Promise<Row[]> {
  return keys.size === 0 ? [] : read([...keys]);
}

function personName(row: { key: string; f_name: string; l_name: string }): string {
  return `${row.f_name} ${row.l_name}`.trim() || row.key;
}

function collectKeys(overrides: readonly HideOverrideRow[], tombstones: readonly string[]): {
  users: Set<string>;
  teams: Set<string>;
  tasks: Set<string>;
  contests: Set<string>;
} {
  const users = new Set(tombstones);
  const teams = new Set<string>();
  const tasks = new Set<string>();
  const contests = new Set<string>();
  const into = (set: Set<string>, key: string): void => {
    for (const candidate of keySpellings(key)) set.add(candidate);
  };
  for (const row of overrides) {
    if (row.targetKind === 'user') into(users, row.targetKey);
    else if (row.targetKind === 'team') into(teams, row.targetKey);
    else if (row.targetKind === 'task') into(tasks, taskKeyPart(row.targetKey));
    else if (row.targetKind === 'contest') into(contests, row.targetKey);
  }
  return { users, teams, tasks, contests };
}

/**
 * The names the board has for the hides' targets.
 *
 * WHY the task read is scoped by `contest_id`: the same task name exists in many contests, and the
 * board draws one contest's columns — an unscoped read would report a hide of another contest's
 * column as applying here, which is exactly the false alarm this surface is meant to end.
 */
async function readProjection(
  contestId: number,
  overrides: readonly HideOverrideRow[],
  tombstones: readonly string[],
): Promise<HideProjection> {
  const keys = collectKeys(overrides, tombstones);
  const [users, teams, tasks, contests] = await Promise.all([
    readKeys(keys.users, (wanted) =>
      prisma.ranking_users.findMany({
        where: { key: { in: wanted } },
        select: { key: true, f_name: true, l_name: true },
      }),
    ),
    readKeys(keys.teams, (wanted) =>
      prisma.ranking_teams.findMany({ where: { key: { in: wanted } }, select: { key: true, name: true } }),
    ),
    readKeys(keys.tasks, (wanted) =>
      prisma.ranking_tasks.findMany({
        where: { contest_id: contestId, key: { in: wanted } },
        select: { key: true, name: true },
      }),
    ),
    readKeys(keys.contests, (wanted) =>
      prisma.ranking_contests.findMany({
        where: { key: { in: wanted } },
        select: { key: true, name: true },
      }),
    ),
  ]);
  return {
    users: new Map(users.map((row) => [row.key, personName(row)])),
    teams: new Map(teams.map((row) => [row.key, row.name])),
    tasks: new Map(tasks.map((row) => [row.key, row.name])),
    contests: new Map(contests.map((row) => [row.key, row.name])),
  };
}

async function attribute(
  rows: ReadonlyArray<{ target_kind: string; target_key: string; reason: string | null; created_by: number | null }>,
): Promise<HideOverrideRow[]> {
  const names = await loadActorNames(
    rows.map((row) => row.created_by).filter((id): id is number => id !== null),
  );
  return rows.map((row) => ({
    targetKind: row.target_kind,
    targetKey: row.target_key,
    reason: row.reason,
    createdBy: row.created_by,
    createdByName: row.created_by === null ? null : (names.get(row.created_by) ?? null),
  }));
}

/** Every hide on one shard's board, merged by hidden row, newest writers included. */
export async function readBoardHides(contestId: number): Promise<readonly RankingHide[]> {
  const [overrideRows, tombstones] = await Promise.all([
    prisma.ranking_overrides.findMany({
      where: { action: 'hide', active: true, contest_id: contestId },
      select: { target_kind: true, target_key: true, reason: true, created_by: true },
      orderBy: { id: 'asc' },
    }),
    prisma.ranking_hidden.findMany({ where: { contest_id: contestId }, select: { key: true } }),
  ]);
  const overrides = await attribute(overrideRows);
  const tombstoneKeys = tombstones.map((row) => row.key);
  const projection = await readProjection(contestId, overrides, tombstoneKeys);
  return describeHides(overrides, tombstoneKeys, projection);
}
