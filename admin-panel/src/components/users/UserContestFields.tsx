'use client';

import { cn } from '@/lib/utils';
import type { UserFormState } from './userFormState';

interface UserContestFieldsProps {
  contests: Array<{ id: number; name: string }>;
  contestId: string;
  teamCode: string;
  inputClassName: string;
  onChange: (updates: Partial<UserFormState>) => void;
}

export function UserContestFields({
  contests,
  contestId,
  teamCode,
  inputClassName,
  onChange,
}: UserContestFieldsProps): React.JSX.Element {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contest (Optional)</label>
        <select
          value={contestId}
          onChange={(e) => onChange({ contestId: e.target.value })}
          className={inputClassName}
          title="Contest"
        >
          <option value="">No contest</option>
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>#{contest.id} - {contest.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Code (Optional)</label>
        <input
          type="text"
          value={teamCode}
          onChange={(e) => onChange({ teamCode: e.target.value })}
          className={cn(inputClassName, 'font-mono')}
          placeholder="TEAM_A"
        />
        <p className="text-xs text-muted-foreground">If team code is set, contest must be selected.</p>
      </div>
    </>
  );
}
