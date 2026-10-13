import { InlineAlert } from '@/components/core/InlineAlert';
import { Text } from '@/components/core/Typography';

interface MismatchBannerProps {
  activeContestId: number | null;
  activeContestName: string | null;
  dbActiveContestId: number | null;
  containerContestId?: number | null;
}

function listDisagreeingSources(activeContestId: number | null, dbActiveContestId: number | null, containerContestId: number | null | undefined): string[] {
  // The id on screen is already the database's (the panel reads contests.is_active), so the only
  // two sources that can disagree are that row and the contest the running container serves.
  const databaseId = activeContestId ?? dbActiveContestId;
  return databaseId !== null && containerContestId != null && databaseId !== containerContestId
    ? ['the database and the running container']
    : [];
}

export function MismatchBanner({ activeContestId, activeContestName, dbActiveContestId, containerContestId }: MismatchBannerProps) {
    const disagreeing = listDisagreeingSources(activeContestId, dbActiveContestId, containerContestId);
    return (
        <InlineAlert tone="warning" title="Configuration Mismatch" announce="polite" className="mb-6">
            <Text variant="small">
                The database has contest <strong className="text-foreground">#{activeContestId}</strong>
                {activeContestName ? ` (${activeContestName})` : ''} marked as active
                {containerContestId != null && (
                        <>
                            , while the running container serves contest <strong className="text-foreground">#{containerContestId}</strong>
                        </>
                )}
                .
                {disagreeing.length > 0 && ` Mismatch between ${disagreeing.join(' and ')}.`}
                {' '}This can happen after a failed deploy or manual edits. Click &quot;Activate &amp; Restart Stack&quot; to resolve.
            </Text>
        </InlineAlert>
    );
}
