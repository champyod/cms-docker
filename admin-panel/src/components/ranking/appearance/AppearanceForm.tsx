'use client';

import { useState } from 'react';

import {
  updateRankingAppearance,
  type AppearanceFields,
  type RankingAppearance,
} from '@/app/actions/rankingAppearance';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Grid } from '@/components/core/Layout';
import { SaveButton } from '@/components/core/SaveButton';
import { Text } from '@/components/core/Typography';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useJustSavedFlag } from '@/hooks/useJustSavedFlag';
import type { Dictionary } from '@/lib/dictionary';
import { cn } from '@/lib/utils';

import { AppearanceFieldControl, type AppearanceValue } from './AppearanceFieldControl';
import type { AppearanceSection } from './appearanceSchema';

export type AppearanceCopy = Dictionary['ranking']['appearance'];

interface AppearanceFormProps {
  readonly copy: AppearanceCopy;
  readonly appearance: RankingAppearance;
  readonly sections: readonly AppearanceSection[];
}

/** The editable subset: the credit list is edited and saved on its own page. */
function toAppearanceFields(appearance: RankingAppearance): AppearanceFields {
  return {
    contestId: appearance.contestId,
    title: appearance.title,
    subtitle: appearance.subtitle,
    organisation: appearance.organisation,
    displayName: appearance.displayName,
    accessMode: appearance.accessMode,
    showIdColumn: appearance.showIdColumn,
    anonymous: appearance.anonymous,
    footerText: appearance.footerText,
    creditsText: appearance.creditsText,
    theme: appearance.theme,
    scoreFormat: appearance.scoreFormat,
    perspectives: appearance.perspectives,
  };
}

/** The full-width sections share the page grid with the two-column ones. */
function sectionClassName(section: AppearanceSection): string {
  return cn('space-y-4', section.id === 'advanced' && 'md:col-span-full');
}

/**
 * The appearance the operator edits, held as form state rather than as the inputs' own
 * values.
 *
 * WHY the state starts from the server row and is re-seeded only on a successful write:
 * a re-render must not put the previously stored value back under the operator's hands.
 * An input carrying `defaultValue` does exactly that — the DOM keeps the old text, the
 * re-render re-applies it, and a read-back of a failed save looks like the write landed.
 */
export function AppearanceForm({
  copy,
  appearance,
  sections,
}: AppearanceFormProps): React.JSX.Element {
  const [form, setForm] = useState<AppearanceFields>(() => toAppearanceFields(appearance));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { justSaved, flashSaved } = useJustSavedFlag();
  const runAction = useActionFeedback();
  const router = useAppRouter();

  const changeField = (name: keyof AppearanceFields, value: AppearanceValue): void => {
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const result = await runAction(
        { pending: copy.savePending, success: copy.saveSuccess, failure: copy.saveFailed },
        () => updateRankingAppearance(form),
      );
      // A failure keeps its message on the page: a toast the operator missed must not be
      // the only sign that nothing was written.
      if (result === null || !result.success) {
        setError(result?.error ?? copy.saveFailed);
        return;
      }
      // Re-seeded from what the server stored only now, so the operator edits their own
      // text rather than a value the last render put back.
      setForm(toAppearanceFields(result.appearance));
      flashSaved();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Grid cols={2} gap={6}>
        {sections.map((section) => (
          <Card key={section.id} className={sectionClassName(section)}>
            <Text as="h2" variant="h4">
              {section.title}
            </Text>
            <Grid cols={2} gap={4}>
              {section.fields.map((field) => (
                <div
                  key={field.name}
                  data-field={field.name}
                  data-span={field.span ?? 'half'}
                  className={field.span === 'full' ? 'md:col-span-2' : undefined}
                >
                  <AppearanceFieldControl
                    field={field}
                    value={form[field.name]}
                    disabled={saving}
                    onChange={changeField}
                  />
                </div>
              ))}
            </Grid>
          </Card>
        ))}
      </Grid>
      {error !== null && <InlineAlert tone="destructive">{error}</InlineAlert>}
      <div className="flex items-center justify-end gap-3 border-t border-border/80 pt-4">
        <SaveButton
          saving={saving}
          justSaved={justSaved}
          idleLabel={copy.save}
          savingLabel={copy.saveSaving}
          savedLabel={copy.saveDone}
          disabled={saving}
          onClick={() => {
            void save();
          }}
        />
      </div>
    </div>
  );
}
