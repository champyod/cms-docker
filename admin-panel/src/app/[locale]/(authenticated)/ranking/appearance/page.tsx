import { getRankingAppearance, submitRankingAppearance, type RankingAppearance } from '@/app/actions/rankingAppearance';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const ACCESS_MODE_PUBLIC = 'public';
const ACCESS_MODE_PROTECTED = 'protected';

type AppearanceCopy = Dictionary['ranking']['appearance'];

interface AppearanceFormProps {
  readonly copy: AppearanceCopy;
  readonly appearance: RankingAppearance;
}

// Plain server form: the write must work before hydration, and the credit list stays on its own page.
function AppearanceForm({ copy, appearance }: AppearanceFormProps): React.JSX.Element {
  return (
    <form action={submitRankingAppearance} className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.title}
      </Text>
      <Input label={copy.titleField} name="title" defaultValue={appearance.title} />
      <Input label={copy.subtitleField} name="subtitle" defaultValue={appearance.subtitle} />
      <Input
        label={copy.organisationField}
        name="organisation"
        defaultValue={appearance.organisation}
      />
      <SelectField
        id="ranking-appearance-access"
        label={copy.accessField}
        name="accessMode"
        defaultValue={appearance.accessMode}
      >
        <option value={ACCESS_MODE_PUBLIC}>{copy.accessPublic}</option>
        <option value={ACCESS_MODE_PROTECTED}>{copy.accessProtected}</option>
      </SelectField>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="showIdColumn"
          defaultChecked={appearance.showIdColumn}
          className="size-4 accent-primary"
        />
        {copy.showIdColumn}
      </label>
      <Input label={copy.footerField} name="footerText" defaultValue={appearance.footerText} />
      <Input label={copy.creditsField} name="creditsText" defaultValue={appearance.creditsText} />
      <Button type="submit" variant="positive">
        {copy.save}
      </Button>
    </form>
  );
}

export default async function RankingAppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.appearance'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const appearance = await getRankingAppearance();
  const canEdit = effective.has('ranking:appearance');
  return (
    <Stack gap={6}>
      {canEdit ? (
        <Card className="space-y-4">
          <AppearanceForm copy={copy.appearance} appearance={appearance} />
        </Card>
      ) : null}
    </Stack>
  );
}
