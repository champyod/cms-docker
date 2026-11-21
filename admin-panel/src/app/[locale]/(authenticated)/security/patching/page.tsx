import { readPatchingFindingsPage } from '@/app/actions/securityPatching';
import { PatchingPanel } from '@/components/security/PatchingPanel';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { PatchingQueryInput } from '@/lib/security/patching';

/**
 * The patching page: one page of the feed, and the numbers for the whole of it.
 *
 * WHY the query comes off `searchParams` and not from client state: the page is a server component,
 * so the filters, the sort and the page number have to be part of the request for the database to
 * apply them. That also makes every view of this table a link somebody can send.
 *
 * WHY the paged action and not `readPatchingState`: the overview's read builds the digest, and the
 * digest is about the whole feed — computing it here would put a dozen aggregate queries behind a
 * page that renders none of them.
 */
export default async function SecurityPatchingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<PatchingQueryInput>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  // The descriptor is the gate: it demands security:read + patching:read, so a reader
  // missing either key is concealed as a 404 rather than shown an empty page.
  const effective = await authorizeRoutePage('security.patching');
  const [state, dict] = await Promise.all([readPatchingFindingsPage(query), getDictionary(locale)]);
  return (
    <PatchingPanel
      state={state}
      copy={dict.security.patching}
      canWaive={hasEffectivePermission(effective, 'patching:waive')}
    />
  );
}
