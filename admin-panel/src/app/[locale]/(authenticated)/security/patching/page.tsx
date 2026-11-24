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

/** The page is a server component, so the filters, the sort and the page number must be part of the request. */
export default async function SecurityPatchingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<PatchingQueryInput>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  // The descriptor demands security:read and patching:read, so a reader missing either is concealed as a 404.
  const effective = await authorizeRoutePage('security.patching');
  const [state, dict] = await Promise.all([readPatchingFindingsPage(query), getDictionary(locale)]);
  const copy = dict.security.patching;
  // The newest report among the shown rows is what tells a clean table from a producer that stopped pushing.
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
        missing={dict.common.notSet}
        state={state}
        copy={copy}
        canWaive={hasEffectivePermission(effective, 'patching:waive')}
      />
    </ListPage>
  );
}
