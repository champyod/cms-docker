'use client';

import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Select, type SelectOption } from '@/components/core/Select';
import { useDictionary } from '@/hooks/useDictionary';
import { IpAllowlistInput } from './IpAllowlistInput';
import type { ContestOption } from './bulkEditActions';

const FIELD_WIDTH = 'w-full sm:w-64';

function contestOptions(contests: ContestOption[]): SelectOption[] {
  return contests.map((contest) => ({ value: String(contest.id), label: `#${contest.id} - ${contest.name}` }));
}

interface SectionBoxProps {
  title: string;
  children: React.ReactNode;
}

function SectionBox({ title, children }: SectionBoxProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

interface ContestSectionProps {
  contests: ContestOption[];
  selectedContestId: number;
  loading: boolean;
  hasRows: boolean;
  onContestIdChange: (id: number) => void;
  onRunContestMutation: (mode: 'add' | 'remove') => void;
}

export function ContestSection({ contests, selectedContestId, loading, hasRows, onContestIdChange, onRunContestMutation }: ContestSectionProps) {
  return (
    <SectionBox title="Contest membership">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={FIELD_WIDTH}>
          <Select
            label="Contest"
            value={String(selectedContestId)}
            onChange={(event) => onContestIdChange(Number(event.target.value) || 0)}
            options={contestOptions(contests)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="positiveOutline" onClick={() => onRunContestMutation('add')} disabled={loading || !hasRows || !selectedContestId}>
            Add to contest
          </Button>
          <Button
            variant="negativeOutline"
            onClick={() => onRunContestMutation('remove')}
            disabled={loading || !hasRows || !selectedContestId}
          >
            Remove from contest
          </Button>
        </div>
      </div>
    </SectionBox>
  );
}

interface TeamSectionProps {
  contests: ContestOption[];
  teamContestId: number;
  teamCode: string;
  teamsOptions: string[];
  loading: boolean;
  hasRows: boolean;
  onTeamContestIdChange: (id: number) => void;
  onTeamCodeChange: (code: string) => void;
  onRunTeamSet: () => void;
  onRunTeamRemoveAny: () => void;
}

export function TeamSection({ contests, teamContestId, teamCode, teamsOptions, loading, hasRows, onTeamContestIdChange, onTeamCodeChange, onRunTeamSet, onRunTeamRemoveAny }: TeamSectionProps) {
  return (
    <SectionBox title="Team assignment">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={FIELD_WIDTH}>
          <Select
            label="Contest"
            value={String(teamContestId)}
            onChange={(event) => onTeamContestIdChange(Number(event.target.value) || 0)}
            options={contestOptions(contests)}
          />
        </div>
        <div className={FIELD_WIDTH}>
          {teamsOptions.length > 0 ? (
            <Select
              label="Team"
              value={teamCode}
              onChange={(event) => onTeamCodeChange(event.target.value)}
              options={[{ value: '', label: 'Select team' }, ...teamsOptions.map((code) => ({ value: code, label: code }))]}
            />
          ) : (
            <Input
              label="Team code"
              value={teamCode}
              onChange={(event) => onTeamCodeChange(event.target.value)}
              placeholder="Team code"
              className="font-mono"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="positiveOutline" onClick={onRunTeamSet} disabled={loading || !hasRows || !teamContestId}>
            Add to team
          </Button>
          <Button variant="negativeOutline" onClick={onRunTeamRemoveAny} disabled={loading || !hasRows}>
            Remove from any team
          </Button>
        </div>
      </div>
    </SectionBox>
  );
}

interface ProfileSectionProps {
  timezone: string;
  emailDomain: string;
  loading: boolean;
  hasRows: boolean;
  onTimezoneChange: (value: string) => void;
  onEmailDomainChange: (value: string) => void;
  onRunTimezoneUpdate: () => void;
  onRunEmailDomainUpdate: () => void;
  onRunEmailClear: () => void;
}

export function ProfileSection({ timezone, emailDomain, loading, hasRows, onTimezoneChange, onEmailDomainChange, onRunTimezoneUpdate, onRunEmailDomainUpdate, onRunEmailClear }: ProfileSectionProps) {
  return (
    <SectionBox title="Profile fields">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={FIELD_WIDTH}>
          <Input
            label="Timezone"
            value={timezone}
            onChange={(event) => onTimezoneChange(event.target.value)}
            placeholder="Timezone"
          />
        </div>
        <Button variant="ghost" onClick={onRunTimezoneUpdate} disabled={loading || !hasRows}>
          Update timezone
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={FIELD_WIDTH}>
          <Input
            label="Email domain"
            value={emailDomain}
            onChange={(event) => onEmailDomainChange(event.target.value)}
            placeholder="example.com"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onRunEmailDomainUpdate} disabled={loading || !hasRows}>
            Set email domain
          </Button>
          <Button variant="ghost" onClick={onRunEmailClear} disabled={loading || !hasRows}>
            Reset email
          </Button>
        </div>
      </div>
    </SectionBox>
  );
}

interface IpAllowlistSectionProps {
  contests: ContestOption[];
  contestId: number;
  ip: string;
  loading: boolean;
  hasRows: boolean;
  onContestIdChange: (id: number) => void;
  onIpChange: (value: string) => void;
  onRunIpAllowlist: () => void;
}

export function IpAllowlistSection({ contests, contestId, ip, loading, hasRows, onContestIdChange, onIpChange, onRunIpAllowlist }: IpAllowlistSectionProps) {
  const dictionary = useDictionary();
  return (
    <SectionBox title={dictionary.users.bulkEdit.ipTitle}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={FIELD_WIDTH}>
          <Select
            label={dictionary.users.bulkEdit.ipContest}
            value={String(contestId)}
            onChange={(event) => onContestIdChange(Number(event.target.value) || 0)}
            options={contestOptions(contests)}
          />
        </div>
        <IpAllowlistInput value={ip} onChange={onIpChange} />
        <Button variant="positiveOutline" onClick={onRunIpAllowlist} disabled={loading || !hasRows || !contestId}>
          {dictionary.users.bulkEdit.ipApply}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{dictionary.participation.ip.hint}</p>
    </SectionBox>
  );
}

export { BulkEditPreviewTable } from './bulkEditPreviewTable';
