// Why: centralized permission denial uses theme tokens (bg-card, text-foreground) so all error states share one palette
// Why: this component must not be used for route-level permission denial — use notFound() to avoid leaking existence; kept only for embedded inline warnings
import Link from 'next/link';

import { AlertCircle } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

interface PermissionDeniedProperties {
  permission: string;
  locale: string;
  dict: {
    errors: {
      permissionDenied: string;
      permissionRequired: string;
      contactAdmin: string;
      returnToDashboard: string;
    };
  };
}

export function PermissionDenied({ permission, locale, dict }: PermissionDeniedProperties): React.JSX.Element {
  return (
    <Stack align="center" justify="center" className="min-h-96">
      <Card className="p-8 max-w-md bg-destructive/10 border-destructive/20">
        <Stack align="center" gap={4} className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <Text variant="h2">{dict.errors.permissionDenied}</Text>
          <Text variant="muted">{dict.errors.permissionRequired.replace('{permission}', permission)}</Text>
          <Text variant="small" className="text-muted-foreground">
            {dict.errors.contactAdmin}
          </Text>
          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center h-10 px-4 py-2 mt-2 bg-card hover:bg-accent border border-border text-foreground rounded-xl transition-all active:scale-95"
          >
            {dict.errors.returnToDashboard}
          </Link>
        </Stack>
      </Card>
    </Stack>
  );
}
