import { prisma } from '@/lib/prisma';

export interface EntityRef {
  entity: string;
  entity_id: string | null;
}

/**
 * Canonical lookup key for one audit row's resolved target name.
 * Matches the key produced inside `loadEntityNames`.
 */
export function entityNameKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}

type NameLoader = (ids: readonly number[]) => Promise<ReadonlyMap<number, string>>;

interface SelectorSpec<Row> {
  load(ids: number[]): Promise<readonly Row[]>;
  pick(row: Row): [number, string];
}

async function runSelector<Row>(spec: SelectorSpec<Row>, ids: readonly number[]): Promise<ReadonlyMap<number, string>> {
  const rows = await spec.load([...ids]);
  return new Map(rows.map((row) => spec.pick(row)));
}

const contestSpec: SelectorSpec<{ id: number; name: string }> = {
  load: (ids) =>
    prisma.contests.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
  pick: (row) => [row.id, row.name],
};

const taskSpec: SelectorSpec<{ id: number; title: string; name: string }> = {
  load: (ids) =>
    prisma.tasks.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, name: true },
    }),
  // Why: tasks carry a unique slug (name) and a human title; showing both
  // disambiguates slugs that repeat across contests while staying readable.
  pick: (row) => [row.id, row.title === row.name ? row.title : `${row.title} (${row.name})`],
};

const userSpec: SelectorSpec<{ id: number; first_name: string; last_name: string; username: string }> = {
  load: (ids) =>
    prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, first_name: true, last_name: true, username: true },
    }),
  pick: (row) => {
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    const label = fullName.length > 0 ? `${fullName} (${row.username})` : row.username;
    return [row.id, label];
  },
};

const teamSpec: SelectorSpec<{ id: number; name: string }> = {
  load: (ids) =>
    prisma.teams.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
  pick: (row) => [row.id, row.name],
};

const adminSpec: SelectorSpec<{ id: number; name: string; username: string }> = {
  load: (ids) =>
    prisma.admins.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, username: true },
    }),
  pick: (row) => [row.id, row.name.length > 0 ? row.name : row.username],
};

const subjectSpec: SelectorSpec<{ id: number; subject: string }> = {
  load: (ids) =>
    prisma.announcements.findMany({
      where: { id: { in: ids } },
      select: { id: true, subject: true },
    }),
  pick: (row) => [row.id, row.subject],
};

const filenameSpec: SelectorSpec<{ id: number; filename: string }> = {
  load: (ids) =>
    prisma.attachments.findMany({
      where: { id: { in: ids } },
      select: { id: true, filename: true },
    }),
  pick: (row) => [row.id, row.filename],
};

const datasetSpec: SelectorSpec<{ id: number; description: string }> = {
  load: (ids) =>
    prisma.datasets.findMany({
      where: { id: { in: ids } },
      select: { id: true, description: true },
    }),
  pick: (row) => [row.id, row.description],
};

const testcaseSpec: SelectorSpec<{ id: number; codename: string }> = {
  load: (ids) =>
    prisma.testcases.findMany({
      where: { id: { in: ids } },
      select: { id: true, codename: true },
    }),
  pick: (row) => [row.id, row.codename],
};

const groupSpec: SelectorSpec<{ id: number; name: string }> = {
  load: (ids) =>
    prisma.groups.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
  pick: (row) => [row.id, row.name],
};

// Why: entity verbs include 'message' and 'question' whose parent tables both
// expose a user-facing subject column.
const messageSpec: SelectorSpec<{ id: number; subject: string }> = {
  load: (ids) =>
    prisma.messages.findMany({
      where: { id: { in: ids } },
      select: { id: true, subject: true },
    }),
  pick: (row) => [row.id, row.subject],
};

const questionSpec: SelectorSpec<{ id: number; subject: string }> = {
  load: (ids) =>
    prisma.questions.findMany({
      where: { id: { in: ids } },
      select: { id: true, subject: true },
    }),
  pick: (row) => [row.id, row.subject],
};

const managerSpec: SelectorSpec<{ id: number; filename: string }> = {
  load: (ids) =>
    prisma.managers.findMany({
      where: { id: { in: ids } },
      select: { id: true, filename: true },
    }),
  pick: (row) => [row.id, row.filename],
};

// Why: 'deployment' rows reference the same id space as contests (see
// publishFrame in src/lib/audit.ts), so the contest selector resolves them.
const NAME_LOADERS: Readonly<Record<string, NameLoader>> = {
  contest: (ids) => runSelector(contestSpec, ids),
  deployment: (ids) => runSelector(contestSpec, ids),
  task: (ids) => runSelector(taskSpec, ids),
  user: (ids) => runSelector(userSpec, ids),
  team: (ids) => runSelector(teamSpec, ids),
  admin: (ids) => runSelector(adminSpec, ids),
  announcement: (ids) => runSelector(subjectSpec, ids),
  attachment: (ids) => runSelector(filenameSpec, ids),
  dataset: (ids) => runSelector(datasetSpec, ids),
  testcase: (ids) => runSelector(testcaseSpec, ids),
  group: (ids) => runSelector(groupSpec, ids),
  message: (ids) => runSelector(messageSpec, ids),
  question: (ids) => runSelector(questionSpec, ids),
  manager: (ids) => runSelector(managerSpec, ids),
};

/**
 * Batch-resolves display labels for audit rows' target entities, one query per
 * entity type. Entities without a registered loader (statement, submission,
 * participation, infra targets, ...) and rows whose id fails to parse are
 * skipped, leaving the caller's `#id` fallback in charge.
 */
export async function loadEntityNames(refs: readonly EntityRef[]): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  const byEntity = new Map<string, number[]>();
  for (const ref of refs) {
    if (ref.entity_id === null) continue;
    const id = Number(ref.entity_id);
    if (!Number.isSafeInteger(id)) continue;
    const existing = byEntity.get(ref.entity);
    if (existing) existing.push(id);
    else byEntity.set(ref.entity, [id]);
  }
  for (const [entity, ids] of byEntity) {
    const loader = NAME_LOADERS[entity];
    if (!loader) continue;
    const labels = await loader(ids);
    for (const id of ids) {
      const label = labels.get(id);
      if (label !== undefined) names.set(entityNameKey(entity, String(id)), label);
    }
  }
  return names;
}