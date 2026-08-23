import { XCircle } from 'lucide-react';
import { Text } from '@/components/core/Typography';

interface MismatchBannerProps {
  activeContestId: number | null;
  activeContestName: string | null;
  dbActiveContestId: number | null;
}

export function MismatchBanner({ activeContestId, activeContestName, dbActiveContestId }: MismatchBannerProps) {
    return (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
                <Text variant="h3" color="text-red-400">Configuration Mismatch</Text>
                <Text variant="small" color="text-neutral-300">
                    The .env file points to contest <strong className="text-white">#{activeContestId}</strong>
                    {activeContestName ? ` (${activeContestName})` : ''},
                    but the database has contest <strong className="text-white">#{dbActiveContestId}</strong> marked as active.
                    This can happen after a failed deploy or manual edits. Click "Activate & Restart Stack" to resolve.
                </Text>
            </div>
        </div>
    );
}
