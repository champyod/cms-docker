import { InlineAlert } from '@/components/core/InlineAlert';
import { Text } from '@/components/core/Typography';

interface MismatchBannerProps {
  activeContestId: number | null;
  activeContestName: string | null;
  dbActiveContestId: number | null;
  containerContestId?: number | null;
  boundContestId?: number | null;
}

interface ContestSource {
  readonly label: string;
  /** The contest this source names, or null when it names none to compare. */
  readonly id: number | null;
}

// Why three named sources and not a boolean: the page exists to show what each one holds, and a
// reader who sees "mismatch" has to be able to tell which of them to go and fix.
const DATABASE_SOURCE = 'the database';
const CONFIGURED_SOURCE = 'the configured CONTEST_ID';
const REGISTRY_SOURCE = 'the service registry';

/**
 * The three values the page compares. WHY the container's CONTEST_ID is labelled as
 * configuration and not as what is served: it is the bootstrap a stack with no contests
 * table yet is read from, so a running stack may serve a contest this id never named.
 */
function contestSources(
  activeContestId: number | null,
  dbActiveContestId: number | null,
  containerContestId: number | null | undefined,
  boundContestId: number | null | undefined,
): ContestSource[] {
  return [
    { label: DATABASE_SOURCE, id: activeContestId ?? dbActiveContestId },
    { label: CONFIGURED_SOURCE, id: containerContestId ?? null },
    { label: REGISTRY_SOURCE, id: boundContestId ?? null },
  ];
}

/**
 * The sources that disagree: those holding a value most of the others already agree on.
 *
 * WHY a majority and not "any pair that differs": when two sources hold contest 1 and one holds
 * 5, the honest report names the one holding 5, not all three — naming the two that agree sends
 * the operator to change a value that is right.
 */
function disagreeingSources(sources: readonly ContestSource[]): string[] {
  const held = sources.filter((source) => source.id !== null);
  if (held.length < 2) return [];
  const counts = new Map<number, number>();
  for (const source of held) {
    const id = source.id;
    if (id === null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const majority = [...counts.entries()].reduce<[number, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null,
  );
  if (majority === null || majority[1] < 2) return held.map((source) => source.label);
  return held.filter((source) => source.id !== majority[0]).map((source) => source.label);
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function describeMismatch(sources: readonly ContestSource[]): string {
  const disagreeing = disagreeingSources(sources);
  if (disagreeing.length === 0) return '';
  const verb = disagreeing.length === 1 ? 'disagrees with the other sources' : 'disagree with each other';
  return ` Mismatch: ${joinNames(disagreeing)} ${verb}.`;
}

export function MismatchBanner({ activeContestId, activeContestName, dbActiveContestId, containerContestId, boundContestId }: MismatchBannerProps) {
    const sources = contestSources(activeContestId, dbActiveContestId, containerContestId, boundContestId);
    const databaseId = activeContestId ?? dbActiveContestId;
    return (
        <InlineAlert tone="warning" title="Configuration Mismatch" announce="polite" className="mb-6">
            <Text variant="small">
                The database has contest <strong className="text-foreground">#{databaseId}</strong>
                {activeContestName ? ` (${activeContestName})` : ''} marked as active
                {containerContestId != null && (
                        <>
                            , while the contest stack was configured with CONTEST_ID <strong className="text-foreground">#{containerContestId}</strong>
                        </>
                )}
                {boundContestId != null && (
                        <>
                            , and the service registry binds the contest web server to contest <strong className="text-foreground">#{boundContestId}</strong>
                        </>
                )}
                .
                {describeMismatch(sources)}
                {' '}This can happen after a failed deploy or manual edits. Activate &amp; Restart Stack rewrites the
                database row, while the registry row decides which contest a server actually serves.
            </Text>
        </InlineAlert>
    );
}
