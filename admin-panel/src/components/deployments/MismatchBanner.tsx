import { XCircle } from 'lucide-react';
import { Text } from '@/components/core/Typography';

interface MismatchBannerProps {
  activeContestId: number | null;
  activeContestName: string | null;
  dbActiveContestId: number | null;
}

export function MismatchBanner({ activeContestId, activeContestName, dbActiveContestId }: MismatchBannerProps) {
    return (
        <div className="mb-6 p-4 bg-warning/10 border border-warning/30 rounded-xl flex items-start gap-3">
            <XCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
                <Text variant="h3" color="text-warning">Configuration Mismatch</Text>
                <Text variant="small" color="text-muted-foreground">
                    The .env file points to contest <strong className="text-foreground">#{activeContestId}</strong>
                    {activeContestName ? ` (${activeContestName})` : ''},
                    but the database has contest <strong className="text-foreground">#{dbActiveContestId}</strong> marked as active.
                    This can happen after a failed deploy or manual edits. Click &quot;Activate &amp; Restart Stack&quot; to resolve.
                </Text>
            </div>
        </div>
    );
}
