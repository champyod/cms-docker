import { readPatchingState } from '@/app/actions/securityPatching';
import { PatchingPanel } from '@/components/security/PatchingPanel';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';

export default async function SecurityPatchingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  // The descriptor is the gate: it demands security:read + patching:read, so a reader
  // missing either key is concealed as a 404 rather than shown an empty page.
  const effective = await authorizeRoutePage('security.patching');
  const [state, dict] = await Promise.all([readPatchingState(), getDictionary(locale)]);
  return (
    <PatchingPanel
      state={state}
      copy={dict.security.patching}
      canWaive={hasEffectivePermission(effective, 'patching:waive')}
    />
  );
}
