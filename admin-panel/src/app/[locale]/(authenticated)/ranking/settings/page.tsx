import {
  endRankingOverride,
  getRankingOverrides,
  saveRankingOverride,
  type RankingOverride,
} from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Grid, Stack } from '@/components/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const NO_OVERRIDES_MESSAGE = 'No manual overrides are active.';

type OverrideCopy = Dictionary['ranking']['overrides'];

interface OverrideFormProps {
  readonly copy: OverrideCopy;
}

function OverrideForm({ copy }: OverrideFormProps): React.JSX.Element {
  return (
    <form action={saveRankingOverride}>
      <Grid cols={2} gap={3}>
        <Input label={copy.contestId} name="contestId" inputMode="numeric" required />
        <SelectField id="ranking-override-target" label={copy.target} name="targetKind">
          <option value="user">user</option>
          <option value="team">team</option>
        </SelectField>
        <Input label={copy.targetKey} name="targetKey" required />
        <SelectField id="ranking-override-action" label={copy.action} name="action">
          <option value="hide">{copy.actionHide}</option>
          <option value="guest">{copy.actionGuest}</option>
          <option value="pin">{copy.actionPin}</option>
          <option value="rename">{copy.actionRename}</option>
          <option value="score">{copy.actionScore}</option>
          <option value="freeze">{copy.actionFreeze}</option>
        </SelectField>
        <Input label={copy.value} name="value" />
        <Input label={copy.reason} name="reason" required />
        <Button type="submit" variant="positive">
          {copy.add}
        </Button>
      </Grid>
    </form>
  );
}

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
  return (
    <Stack gap={6}>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.overrides.title}
        </Text>
        <Text variant="muted">{copy.overrides.hint}</Text>
        {canOverride ? <OverrideForm copy={copy.overrides} /> : null}
        <OverrideList overrides={overrides} canOverride={canOverride} copy={copy.overrides} />
      </Card>
    </Stack>
  );
}
