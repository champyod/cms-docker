import type { UserSummary } from '@/lib/people-read-model-types';

interface UserDetailFrameProps {
  readonly summary: UserSummary;
  /** The already-localised participation count, so this view holds no copy of its own. */
  readonly participationsLabel: string;
}

export function UserDetailFrame({ summary, participationsLabel }: UserDetailFrameProps): React.JSX.Element {
  const meta = [
    summary.status,
    summary.organization,
    summary.country,
    participationsLabel,
  ].filter(Boolean);
  return <span className="text-muted-foreground">{meta.join(' · ')}</span>;
}
