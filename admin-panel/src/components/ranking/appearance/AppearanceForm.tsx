import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

import {
  submitRankingAppearance,
  type AppearanceFields,
  type RankingAppearance,
} from '@/app/actions/rankingAppearance';

import { AppearanceFieldControl } from './AppearanceFieldControl';
import type { AppearanceSection } from './appearanceSchema';

export type AppearanceCopy = {
  readonly save: string;
};

interface AppearanceFormProps {
  readonly copy: AppearanceCopy;
  readonly appearance: RankingAppearance;
  readonly sections: readonly AppearanceSection[];
}

function fieldValue(appearance: RankingAppearance, name: keyof AppearanceFields): string | boolean {
  return appearance[name];
}

/** The write must work before hydration, so the form is a plain server form. */
export function AppearanceForm({
  copy,
  appearance,
  sections,
}: AppearanceFormProps): React.JSX.Element {
  return (
    <form action={submitRankingAppearance} className="space-y-8">
      {sections.map((section) => (
        <Stack key={section.id} gap={3}>
          <Text as="h2" variant="h3">
            {section.title}
          </Text>
          {section.fields.map((field) => (
            <AppearanceFieldControl
              key={field.name}
              field={field}
              value={fieldValue(appearance, field.name)}
            />
          ))}
        </Stack>
      ))}
      <Button type="submit" variant="positive">
        {copy.save}
      </Button>
    </form>
  );
}
