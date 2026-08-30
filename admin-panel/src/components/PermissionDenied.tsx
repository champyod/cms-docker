import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface PermissionDeniedProps {
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

export function PermissionDenied({ permission, locale, dict }: PermissionDeniedProps) {
  return (
    <Stack align="center" justify="center" className="min-h-[60vh]">
      <Card className="p-8 max-w-md bg-red-500/10 border-red-500/20">
        <Stack align="center" gap={4} className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <Text variant="h2">{dict.errors.permissionDenied}</Text>
          <Text variant="muted">
            {dict.errors.permissionRequired.replace('{permission}', permission)}
          </Text>
          <Text variant="small" className="text-neutral-500">
            {dict.errors.contactAdmin}
          </Text>
          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center h-10 px-4 py-2 mt-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl transition-all active:scale-95"
          >
            {dict.errors.returnToDashboard}
          </Link>
        </Stack>
      </Card>
    </Stack>
  );
}
