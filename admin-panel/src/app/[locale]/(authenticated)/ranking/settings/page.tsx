import { getRankingOverrideOptions } from '@/app/actions/ranking';
import {
  endRankingOverride,
  getRankingOverrides,
  type RankingOverride,
} from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import { RankingOverrideForm } from '@/components/ranking/RankingOverrideForm';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const NO_OVERRIDES_MESSAGE = 'No manual overrides are active.';

type OverrideCopy = Dictionary['ranking']['overrides'];

interface OverrideRowProps {
  readonly override: RankingOverride;
  readonly canOverride: boolean;
  readonly copy: OverrideCopy;
}

function OverrideRow({ override, canOverride, copy }: OverrideRowProps): React.JSX.Element {
  const target = `${override.action} ${override.targetKind} ${override.targetKey}`;
  const value = override.value === '' ? '' : ` (${override.value})`;
  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-muted-foreground">{override.id}</span>{' '}
        <span>
          {target}
          {value}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{override.contestId}</TableCell>
      <TableCell className="text-muted-foreground">{override.reason}</TableCell>
      {canOverride ? (
        <TableCell className="text-right">
          <form action={endRankingOverride} className="flex items-center justify-end gap-2">
            <input type="hidden" name="id" value={override.id} />
            <Input name="reason" required placeholder={copy.reason} className="w-40" />
            <Button type="submit" variant="negative" size="sm">
              {copy.end}
            </Button>
          </form>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

interface OverrideListProps {
  readonly overrides: readonly RankingOverride[];
  readonly canOverride: boolean;
  readonly copy: OverrideCopy;
}

function OverrideList({ overrides, canOverride, copy }: OverrideListProps): React.JSX.Element {
  if (overrides.length === 0) {
    return <EmptyState title={NO_OVERRIDES_MESSAGE} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.target}</TableHead>
          <TableHead>{copy.contestId}</TableHead>
          <TableHead>{copy.reason}</TableHead>
          {canOverride ? <TableHead className="text-right">{copy.end}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {overrides.map((override) => (
          <OverrideRow
            key={override.id}
            override={override}
            canOverride={canOverride}
            copy={copy}
          />
        ))}
      </TableBody>
    </Table>
  );
}

// Plain server forms: each override writes one row and must work before hydration.
export default async function RankingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.settings'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const overrides = await getRankingOverrides();
  const canOverride = effective.has('ranking:override');
  const options = canOverride ? await getRankingOverrideOptions() : null;
  return (
    <Stack gap={6}>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.overrides.title}
        </Text>
        <Text variant="muted">{copy.overrides.hint}</Text>
        {canOverride && options !== null ? (
          <RankingOverrideForm
            copy={copy.overrides}
            contests={options.contests}
            userKeys={options.userKeys}
            teamKeys={options.teamKeys}
            contestKeys={options.contestKeys}
            taskKeys={options.taskKeys}
            contestId=""
            targetKind="user"
            targetKey=""
          />
        ) : null}
        <OverrideList overrides={overrides} canOverride={canOverride} copy={copy.overrides} />
      </Card>
    </Stack>
  );
}
