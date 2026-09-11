import { getAuditLog } from '@/app/actions/audit';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { AuditTable } from '@/components/audit/AuditTable';

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    entity?: string;
    verb?: string;
    actorId?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('audit:read', false);

  if (!hasPermission) {
    notFound();
  }

  const sp = await searchParams;
  const page = Number(sp.page) || 1;

  const result = await getAuditLog({
    page,
    entity: sp.entity,
    verb: sp.verb,
    actorId: sp.actorId,
    fromDate: sp.fromDate,
    toDate: sp.toDate,
  });

  const permissions = await getPermissions();

  if (!result.success) {
    return (
      <Stack gap={8}>
        <Stack gap={2}>
          <Text variant="h1">{dict.audit.title}</Text>
          <Text variant="muted">{dict.audit.subtitle}</Text>
        </Stack>
        <Text variant="muted">{result.error}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.audit.title}</Text>
        <Text variant="muted">{dict.audit.subtitle}</Text>
      </Stack>
      <AuditTable
        entries={result.data.entries}
        total={result.data.total}
        totalPages={result.data.totalPages}
        currentPage={page}
        filters={{
          entity: sp.entity,
          verb: sp.verb,
          actorId: sp.actorId,
          fromDate: sp.fromDate,
          toDate: sp.toDate,
        }}
        dict={dict.audit}
        permissionKeys={Array.from(permissions)}
      />
    </Stack>
  );
}
