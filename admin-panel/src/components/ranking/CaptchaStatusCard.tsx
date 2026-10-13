import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { StatusPill } from '@/components/core/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import type { CaptchaStatus } from '@/lib/captcha-status';
import type { Dictionary } from '@/lib/dictionary';

type LockoutCopy = Dictionary['ranking']['lockouts'];

interface CaptchaStatusCardProps {
  readonly status: CaptchaStatus;
  readonly copy: LockoutCopy;
}

export function CaptchaStatusCard({ status, copy }: CaptchaStatusCardProps): React.JSX.Element {
  return (
    <Card>
      <Stack gap={4}>
        <Text as="h2" variant="h3">
          {copy.captchaTitle}
        </Text>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>
            {copy.captchaEnabled}: {status.enabled ? copy.enabledOn : copy.enabledOff}
          </span>
          <span>
            {copy.captchaThreshold}: {status.threshold}
          </span>
          <span>
            {copy.captchaBanThreshold}: {status.banThreshold}
          </span>
          <span className="flex items-center gap-2">
            {copy.captchaCounterStore}
            <StatusPill status={status.counterStoreReachable ? 'connected' : 'disconnected'} />
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.captchaProvider}</TableHead>
              <TableHead>{copy.captchaHealth}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.providers.map((entry) => (
              <TableRow key={entry.provider}>
                <TableCell>{entry.provider}</TableCell>
                <TableCell>
                  <StatusPill status={entry.healthy ? 'healthy' : 'unhealthy'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Card>
  );
}
