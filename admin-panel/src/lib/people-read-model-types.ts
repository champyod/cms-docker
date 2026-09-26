import type { UsersPageRow } from '@/lib/prisma-selects';
import type { SubmissionListItem } from '@/types';

export interface UserSummary {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  status: string | null;
  organization: string | null;
  country: string | null;
  participationCount: number;
  teamCodes: readonly string[];
}

export interface UserProfile {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  timezone: string | null;
  preferredLanguages: readonly string[];
  status: string | null;
  organization: string | null;
  country: string | null;
}

export interface UserTeamMembership {
  id: number;
  contestId: number | null;
  contestName: string | null;
  teamId: number | null;
  teamCode: string | null;
  teamName: string | null;
}

export interface UserHistoryParticipation {
  id: number;
  contestId: number | null;
  contestName: string | null;
  contestStart: string | null;
  contestStop: string | null;
  teamId: number | null;
  teamCode: string | null;
  startingTime: string | null;
  delayTimeSeconds: number | null;
  extraTimeSeconds: number | null;
}

export interface UserHistorySubmission {
  id: number;
  contestId: number | null;
  contestName: string | null;
  taskId: number | null;
  taskName: string | null;
  timestamp: string;
  language: string | null;
  official: boolean | null;
  score: number | null;
}

export interface UserHistory {
  accountAccess: { lastLoginAt: string | null };
  participations: readonly UserHistoryParticipation[];
  contests: readonly { id: number | null; name: string | null; start: string | null; stop: string | null }[];
  teams: readonly { id: number | null; code: string | null; name: string | null }[];
  submissions: readonly UserHistorySubmission[];
  recentContestActivity: readonly UserHistorySubmission[];
}

export interface TeamSummary {
  id: number;
  code: string | null;
  name: string | null;
  organization: string | null;
  leaderId: number | null;
  leader: { id: number; username: string; firstName: string; lastName: string } | null;
  participationCount: number;
}

export interface TeamMember {
  userId: number | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  contests: readonly { id: number | null; name: string | null }[];
}

export interface TeamContest {
  id: number | null;
  name: string | null;
  description: string | null;
  start: string | null;
  stop: string | null;
}

export interface UsersPageResult {
  users: readonly UsersPageRow[];
  totalPages: number;
  currentPage: number;
  perPage: number;
  total: number;
  effectivePermissions: ReadonlySet<string>;
}

export interface TeamsPageResult {
  teams: readonly TeamSummary[];
  effectivePermissions: ReadonlySet<string>;
}

export interface SubmissionsPageResult {
  submissions: readonly SubmissionListItem[];
  totalPages: number;
  total: number;
  effectivePermissions: ReadonlySet<string>;
}
