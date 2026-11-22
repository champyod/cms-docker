import { LinkButton } from '@/components/core/LinkButton';

import { readPatchingFindingsPage } from '@/app/actions/securityPatching';
import { ListPage } from '@/components/patterns/ListPage';
import { PatchingFooter } from '@/components/security/PatchingFooter';
import { PatchingPanel } from '@/components/security/PatchingPanel';
import { PatchingToolbar } from '@/components/security/PatchingToolbar';
import { getDictionary } from '@/i18n';
import { buildRoute } from '@/lib/navigation/routes';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { patchingSearchParams, type PatchingQueryInput } from '@/lib/security/patching';

/** Fills `{count}` in the sentence; the number is the same SQL count the filter selects. */
function counted(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

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
 *
 * WHY the rows, the controls and the arithmetic are three components: the list layout decides where
 * each of the three sits, so each one supplies its facts and none of them draws a frame of its own.
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
  const copy = dict.security.patching;
  // The newest report among the rows shown: the feed's own age, which is what tells a clean table
  // from a producer that stopped pushing.
  const newest = state.groups
    .flatMap((group) => group.findings)
    .reduce<string | null>(
      (latest, finding) => (latest === null || finding.lastSeen > latest ? finding.lastSeen : latest),
      null,
    );
  const flipParams = new URLSearchParams(
    patchingSearchParams({ ...state.page.query, flip: 'waived', page: 1 }),
  ).toString();
  return (
    <ListPage
      // The security module shell renders this page's name, description and trail from the
      // navigation registry, so the page supplies its state, its rows and nothing else.
      ownsHeader={false}
      state={
        state.waivedReachable > 0
          ? {
              tone: 'destructive',
              title: counted(copy.filters.flipNotice, state.waivedReachable),
              action: (
                <LinkButton
                  variant="secondary"
                  size="sm"
                  href={`${buildRoute(locale, 'security.patching')}?${flipParams}`}
                >
                  {copy.filters.flipLink}
                </LinkButton>
              ),
            }
          : undefined
      }
      toolbar={<PatchingToolbar page={state.page} copy={copy} canWaive={hasEffectivePermission(effective, 'patching:waive')} />}
      footer={<PatchingFooter page={state.page} cards={state.cards} newest={newest} copy={copy} />}
    >
      <PatchingPanel
        state={state}
        copy={copy}
        canWaive={hasEffectivePermission(effective, 'patching:waive')}
      />
    </ListPage>
  );
}
