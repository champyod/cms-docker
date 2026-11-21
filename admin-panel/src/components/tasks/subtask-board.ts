import type { SubtaskRow } from './dataset-score-params';

export const SUBTASK_POOL_ZONE_ID = 'subtask-pool';

export interface SubtaskGroup {
  id: string;
  name: string;
  maxScore: string;
  threshold: string;
  testcases: string[];
}

export interface UploadSubtaskGroup {
  name: string;
  testcases: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Why the anchor: the CMS score types use Python re.match, which only
// matches at the start of a codename, while RegExp.test searches
// anywhere. The anchor keeps the board's membership identical to what
// the worker will compute.
function matchesFromStart(codename: string, regex: string): boolean {
  try {
    return new RegExp(`^(?:${regex})`).test(codename);
  } catch {
    return false;
  }
}

function codenameSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

// Why the separator cut: the common prefix of subtask1_01 and
// subtask1_02 is subtask1_0, which is not a valid group boundary.
// Cutting at the last _ or - yields subtask1_, the prefix a regex
// like subtask1_.* needs to describe the whole group.
function separatorPrefix(members: readonly string[]): string {
  if (members.length === 0) return '';
  let prefix = members[0];
  for (const member of members) {
    while (prefix.length > 0 && !member.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  const cut = Math.max(prefix.lastIndexOf('_'), prefix.lastIndexOf('-'));
  return cut >= 0 ? prefix.slice(0, cut + 1) : '';
}

export function deriveSubtaskRegex(members: readonly string[], allTestcases: readonly string[]): string {
  if (members.length === 0) return '';
  const prefix = separatorPrefix(members);
  if (prefix.length > 0) {
    const withPrefix = allTestcases.filter((codename) => codename.startsWith(prefix));
    const memberSet = new Set(members);
    const isExact = withPrefix.length === members.length
      && withPrefix.every((codename) => memberSet.has(codename));
    if (isExact) return `${escapeRegExp(prefix)}.*`;
  }
  return `^(?:${members.map(escapeRegExp).join('|')})$`;
}

export function groupsFromRows(rows: readonly SubtaskRow[], testcases: readonly string[]): SubtaskGroup[] {
  const sorted = [...testcases].sort(codenameSort);
  const assigned = new Set<string>();
  let cursor = 0;
  return rows.map((row, index) => {
    const members: string[] = [];
    const trimmed = row.testcases.trim();
    if (/^\d+$/.test(trimmed)) {
      const count = parseInt(trimmed, 10);
      while (members.length < count && cursor < sorted.length) {
        const candidate = sorted[cursor];
        cursor += 1;
        if (!assigned.has(candidate)) {
          members.push(candidate);
          assigned.add(candidate);
        }
      }
    } else if (trimmed.length > 0) {
      for (const codename of sorted) {
        if (!assigned.has(codename) && matchesFromStart(codename, trimmed)) {
          members.push(codename);
          assigned.add(codename);
        }
      }
    }
    return {
      id: `subtask-${index}`,
      name: `Subtask ${index + 1}`,
      maxScore: row.maxScore,
      threshold: row.threshold,
      testcases: members,
    };
  });
}

export function rowsFromGroups(groups: readonly SubtaskGroup[], testcases: readonly string[]): SubtaskRow[] {
  return groups.map((group) => ({
    maxScore: group.maxScore,
    testcases: deriveSubtaskRegex(group.testcases, testcases),
    threshold: group.threshold,
  }));
}

export function poolFromGroups(groups: readonly SubtaskGroup[], testcases: readonly string[]): string[] {
  const assigned = new Set(groups.flatMap((group) => group.testcases));
  return testcases.filter((codename) => !assigned.has(codename)).sort(codenameSort);
}

export function detectSubtaskGroups(pairs: readonly { id: string; subtask: string | null }[]): UploadSubtaskGroup[] {
  const members = new Map<string, string[]>();
  for (const pair of pairs) {
    if (!pair.subtask) continue;
    const list = members.get(pair.subtask) ?? [];
    list.push(pair.id);
    members.set(pair.subtask, list);
  }
  return [...members.entries()]
    .map(([name, testcases]) => ({ name, testcases: [...testcases].sort(codenameSort) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

// Why an equal split: uploaded files carry no score information, so the
// points are a starting point the user adjusts in the score editor.
export function buildUploadSubtaskRows(groups: readonly UploadSubtaskGroup[], testcases: readonly string[], totalPoints = 100): SubtaskRow[] {
  const count = groups.length;
  if (count === 0) return [];
  const base = Math.floor(totalPoints / count);
  const remainder = totalPoints - base * count;
  return groups.map((group, index) => ({
    maxScore: String(base + (index < remainder ? 1 : 0)),
    testcases: deriveSubtaskRegex(group.testcases, testcases),
    threshold: '1',
  }));
}
