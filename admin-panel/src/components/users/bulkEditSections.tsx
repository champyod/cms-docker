'use client';

import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/core/Button';
import type { ContestOption } from './bulkEditActions';

const CONTEST_SELECT_CLASS = 'bg-background/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';
const TEXT_INPUT_CLASS = 'bg-background/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

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
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedContestId}
          title="Select contest"
          onChange={(event) => onContestIdChange(Number(event.target.value) || 0)}
          className={CONTEST_SELECT_CLASS}
        >
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>
              #{contest.id} - {contest.name}
            </option>
          ))}
        </select>
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
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={teamContestId}
          title="Select contest for team"
          onChange={(event) => onTeamContestIdChange(Number(event.target.value) || 0)}
          className={CONTEST_SELECT_CLASS}
        >
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>
              #{contest.id} - {contest.name}
            </option>
          ))}
        </select>
        {teamsOptions.length > 0 ? (
          <select
            value={teamCode}
            onChange={(e) => onTeamCodeChange(e.target.value)}
            className={CONTEST_SELECT_CLASS}
            title="Select team"
          >
            <option value="">Select team</option>
            {teamsOptions.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={teamCode}
            onChange={(event) => onTeamCodeChange(event.target.value)}
            placeholder="Team code"
            title="Team code"
            className={`${TEXT_INPUT_CLASS} font-mono`}
          />
        )}
        <Button variant="positiveOutline" onClick={onRunTeamSet} disabled={loading || !hasRows || !teamContestId}>
          Add to team
        </Button>
        <Button variant="negativeOutline" onClick={onRunTeamRemoveAny} disabled={loading || !hasRows}>
          Remove from any team
        </Button>
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
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={timezone}
          onChange={(event) => onTimezoneChange(event.target.value)}
          placeholder="Timezone"
          title="Timezone"
          className={TEXT_INPUT_CLASS}
        />
        <Button variant="ghost" onClick={onRunTimezoneUpdate} disabled={loading || !hasRows}>
          Update timezone
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={emailDomain}
          onChange={(event) => onEmailDomainChange(event.target.value)}
          placeholder="example.com"
          title="Email domain"
          className={TEXT_INPUT_CLASS}
        />
        <Button variant="ghost" onClick={onRunEmailDomainUpdate} disabled={loading || !hasRows}>
          Set email domain
        </Button>
        <Button variant="ghost" onClick={onRunEmailClear} disabled={loading || !hasRows}>
          Reset email
        </Button>
      </div>
    </SectionBox>
  );
}

interface BulkEditPreviewTableProps {
  rows: Array<{ id: number; first_name: string; last_name: string; username: string; password?: string | null; email?: string | null; stored_kind?: 'bcrypt' | 'plaintext' }>;
  revealedIds: number[];
  revealingIds?: number[];
  onToggleRevealRow: (rowId: number) => void;
  onToggleAllRevealed: () => void;
  allRevealed: boolean;
}

export function BulkEditPreviewTable({
  rows,
  revealedIds,
  revealingIds = [],
  onToggleRevealRow,
  onToggleAllRevealed,
  allRevealed,
}: BulkEditPreviewTableProps) {
  const isRevealed = (rowId: number): boolean => revealedIds.includes(rowId);
  const isRevealing = (rowId: number): boolean => revealingIds.includes(rowId);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2">ID</th>
              <th className="text-left px-2 py-2">first_name</th>
              <th className="text-left px-2 py-2">last_name</th>
              <th className="text-left px-2 py-2">username</th>
              <th className="text-left px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  password
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={allRevealed ? EyeOff : Eye}
                    iconOnly
                    tooltip={allRevealed ? 'Hide all passwords' : 'Reveal all passwords'}
                    onClick={onToggleAllRevealed}
                  />
                </span>
              </th>
              <th className="text-left px-2 py-2">email</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No selected users
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-2 py-2 text-muted-foreground">#{row.id}</td>
                  <td className="px-2 py-2">{row.first_name}</td>
                  <td className="px-2 py-2">{row.last_name}</td>
                  <td className="px-2 py-2">{row.username}</td>
                  <td className="px-2 py-2 font-mono">
                    {isRevealed(row.id) && row.password ? (
                      <span className="inline-flex items-center gap-1">
                        {row.password}
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={EyeOff}
                          iconOnly
                          tooltip={`Hide password for ${row.username}`}
                          onClick={() => onToggleRevealRow(row.id)}
                        />
                      </span>
                    ) : row.stored_kind === 'bcrypt' ? (
                      <span className="text-muted-foreground/50">bcrypt ••••</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Eye}
                        iconOnly
                        tooltip={`Reveal password for ${row.username}`}
                        loading={isRevealing(row.id)}
                        onClick={() => onToggleRevealRow(row.id)}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">{row.email || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
