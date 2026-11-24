import { InlineAlert } from '@/components/core/InlineAlert';
import { Text } from '@/components/core/Typography';

interface MismatchBannerProps {
  activeContestId: number | null;
  activeContestName: string | null;
  dbActiveContestId: number | null;
  containerContestId?: number | null;
  boundContestId?: number | null;
  /** Which store answered the bound read; the registry is named only when the registry answered. */
  boundContestSource: 'registry' | 'deployment' | null;
}

interface ContestSource {
  readonly label: string;
  /** The contest this source names, or null when it names none to compare. */
  readonly id: number | null;
}

// The page exists to show what each source holds, so the mismatch names them instead of a boolean.
const DATABASE_SOURCE = 'the database';
const CONFIGURED_SOURCE = 'the configured CONTEST_ID';
const REGISTRY_SOURCE = 'the service registry';

/** CONTEST_ID is the bootstrap a stack without a contests table reads, so a running stack may serve a contest it never named. */
function contestSources(
  activeContestId: number | null,
  dbActiveContestId: number | null,
  containerContestId: number | null | undefined,
  boundContestId: number | null | undefined,
  boundContestSource: 'registry' | 'deployment' | null,
): ContestSource[] {
  return [
    { label: DATABASE_SOURCE, id: activeContestId ?? dbActiveContestId },
    { label: CONFIGURED_SOURCE, id: containerContestId ?? null },
    ...(boundContestSource === 'registry' ? [{ label: REGISTRY_SOURCE, id: boundContestId ?? null }] : []),
  ];
}

/** A majority names the holder of the odd value out, not every pair that differs. */
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

function describeMismatch(disagreeing: readonly string[]): string {
  if (disagreeing.length === 0) return '';
  const verb = disagreeing.length === 1 ? 'disagrees with the other sources' : 'disagree with each other';
  return ` Mismatch: ${joinNames(disagreeing)} ${verb}.`;
}

export function MismatchBanner({
    activeContestId,
    activeContestName,
    dbActiveContestId,
    containerContestId,
    boundContestId,
    boundContestSource,
}: MismatchBannerProps): React.JSX.Element {
    const sources = contestSources(activeContestId, dbActiveContestId, containerContestId, boundContestId, boundContestSource);
    const disagreeing = disagreeingSources(sources);
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
                {boundContestSource === 'registry' && boundContestId != null && (
                        <>
                            , and the service registry binds the contest web server to contest <strong className="text-foreground">#{boundContestId}</strong>
                        </>
                )}
                .
                {describeMismatch(disagreeing)}
                {' '}{disagreeing.includes(REGISTRY_SOURCE)
                    ? 'An enabled registry row that names a contest decides what is served, so edit it in the panel\'s service registry (Infrastructure, Services): activating another contest cannot clear this.'
                    : 'This can happen after a failed deploy or manual edits. The database row is the deployment default; what a running instance actually serves is the registry row for its shard, so write that row in the panel (Infrastructure, Services) and the instance follows within seconds.'}
            </Text>
        </InlineAlert>
    );
}
