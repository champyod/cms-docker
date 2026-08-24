'use client';

import { Button } from '@/components/core/Button';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import type { ContestOption } from './bulkEditActions';

const CONTEST_SELECT_CLASS = 'bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white';
const TEXT_INPUT_CLASS = 'bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white';

interface SectionBoxProps {
  title: string;
  children: React.ReactNode;
}

function SectionBox({ title, children }: SectionBoxProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
      <div className="text-xs text-neutral-300">{title}</div>
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
        <Button variant="ghost" onClick={() => onRunContestMutation('add')} disabled={loading || !hasRows || !selectedContestId}>
          Add to contest
        </Button>
        <Button variant="ghost" onClick={() => onRunContestMutation('remove')} disabled={loading || !hasRows || !selectedContestId}>
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
        <Button variant="ghost" onClick={onRunTeamSet} disabled={loading || !hasRows || !teamContestId}>
          Add to team
        </Button>
        <Button variant="ghost" onClick={onRunTeamRemoveAny} disabled={loading || !hasRows}>
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

export function BulkEditPreviewTable({ rows, revealedIds, revealingIds = [], onToggleRevealRow, onToggleAllRevealed, allRevealed }: BulkEditPreviewTableProps) {
  const isRevealed = (rowId: number): boolean => revealedIds.includes(rowId);
  const isRevealing = (rowId: number): boolean => revealingIds.includes(rowId);
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/5 text-neutral-300 sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2">ID</th>
              <th className="text-left px-2 py-2">first_name</th>
              <th className="text-left px-2 py-2">last_name</th>
              <th className="text-left px-2 py-2">username</th>
              <th className="text-left px-2 py-2">
                <span className="inline-flex items-center gap-1">
                  password
                  <button
                    type="button"
                    aria-label={allRevealed ? 'Hide all passwords' : 'Reveal all passwords'}
                    title={allRevealed ? 'Hide all passwords' : 'Reveal all passwords'}
                    onClick={onToggleAllRevealed}
                    className="p-0.5 rounded hover:bg-white/10 text-neutral-400 hover:text-indigo-300 transition-colors"
                  >
                    {allRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </span>
              </th>
              <th className="text-left px-2 py-2">email</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No selected users
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="px-2 py-2 text-neutral-400">#{row.id}</td>
                  <td className="px-2 py-2 text-white">{row.first_name}</td>
                  <td className="px-2 py-2 text-white">{row.last_name}</td>
                  <td className="px-2 py-2 text-white">{row.username}</td>
                  <td className="px-2 py-2 font-mono">
                    {isRevealed(row.id) && row.password ? (
                      <span className="inline-flex items-center gap-1 text-white">
                        {row.password}
                        <button
                          type="button"
                          aria-label={`Hide password for ${row.username}`}
                          title={`Hide password for ${row.username}`}
                          onClick={() => onToggleRevealRow(row.id)}
                          className="p-0.5 rounded hover:bg-white/10 text-neutral-500 hover:text-indigo-300 transition-colors"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ) : row.stored_kind === 'bcrypt' ? (
                      <span className="text-neutral-600">bcrypt ••••</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Reveal password for ${row.username}`}
                        title={`Reveal password for ${row.username}`}
                        disabled={isRevealing(row.id)}
                        onClick={() => onToggleRevealRow(row.id)}
                        className="p-0.5 rounded hover:bg-white/10 text-neutral-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
                      >
                        {isRevealing(row.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-white">{row.email || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
