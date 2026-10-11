import { saveRankingOverride } from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Grid } from '@/components/core/Layout';
import type { Dictionary } from '@/lib/dictionary';

export type RankingOverrideCopy = Dictionary['ranking']['overrides'];

export interface RankingOverrideFormProps {
  readonly copy: RankingOverrideCopy;
  readonly contestId: string;
  readonly targetKind: string;
  readonly targetKey: string;
}

// Plain server form: each override writes one row and must work before hydration.
export function RankingOverrideForm({
  copy,
  contestId,
  targetKind,
  targetKey,
}: RankingOverrideFormProps): React.JSX.Element {
  return (
    <form action={saveRankingOverride}>
      <Grid cols={2} gap={3}>
        <Input
          label={copy.contestId}
          name="contestId"
          inputMode="numeric"
          defaultValue={contestId}
          required
        />
        <SelectField
          id="ranking-user-override-kind"
          label={copy.target}
          name="targetKind"
          defaultValue={targetKind}
        >
          <option value="user">{copy.targetUser}</option>
          <option value="team">{copy.targetTeam}</option>
        </SelectField>
        <Input label={copy.targetKey} name="targetKey" defaultValue={targetKey} required />
        <SelectField id="ranking-user-override-action" label={copy.action} name="action">
          <option value="hide">{copy.actionHide}</option>
          <option value="guest">{copy.actionGuest}</option>
          <option value="pin">{copy.actionPin}</option>
          <option value="rename">{copy.actionRename}</option>
          <option value="score">{copy.actionScore}</option>
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
