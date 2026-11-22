import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getDictionary } from '@/i18n';
import { getUserProfile, getUserSummary } from '@/lib/people-read-models';
import { readRecordOrNotFound, parseRecordId } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { UserProfileTab } from '@/components/users/UserProfileTab';

// Why: a value the record does not carry is shown as the panel's missing mark rather than as an
// empty cell, so "no email on file" cannot be read as "the field did not load".
const MISSING = '—';

async function authorizeUserTab(routeId: RouteId): Promise<ReadonlySet<string>> {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route || !route.enabled) notFound();
  try {
    let effective: ReadonlySet<string> = new Set<string>();
    for (const key of route.permission.all ?? []) effective = await requirePermission(key);
    if (!isRoutePermitted(route, effective)) notFound();
    return effective;
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

function orMissing(value: string | null): string {
  return value === null || value.trim() === '' ? MISSING : value;
}

function joined(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : MISSING;
}

export default async function UserProfilePage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await authorizeUserTab('people.user-tabs.profile');
  const dictionary = await getDictionary(locale);
  const [profile, summary] = await Promise.all([
    readRecordOrNotFound(() => getUserProfile(id)),
    readRecordOrNotFound(() => getUserSummary(id)),
  ]);
  const copy = dictionary.users.profile;
  return (
    <DetailPage
      // The record shell above renders the username, the trail and the tabs; the profile is one
      // record's values, so the layout's fact strip carries them and the tab keeps only what the
      // strip cannot: the saved password and the one action that reads it.
      ownsHeader={false}
      title={summary.username}
      // Why only five values: the shell's header already prints the status, the organization, the
      // country and the participation count, so listing them again would be a second copy of a
      // fact the reader has just read. These five are what the profile adds to that header.
      facts={[
        { term: copy.name, value: orMissing(`${profile.firstName} ${profile.lastName}`.trim()) },
        { term: copy.email, value: orMissing(profile.email) },
        { term: copy.timezone, value: orMissing(profile.timezone) },
        { term: copy.languages, value: joined(profile.preferredLanguages) },
        { term: copy.teams, value: joined(summary.teamCodes) },
      ]}
    >
      <UserProfileTab userId={summary.id} copy={dictionary.users} permissionKeys={[...effective]} />
    </DetailPage>
  );
}
