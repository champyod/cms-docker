'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveRankingAppearance, type RankingAppearance } from '@/app/actions/rankingAppearance';
import { Button } from '@/components/core/Button';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Text } from '@/components/core/Typography';
import type { Dictionary } from '@/lib/dictionary';

const ACCESS_MODE_PUBLIC = 'public';
const ACCESS_MODE_PROTECTED = 'protected';

type AppearanceCopy = Dictionary['ranking']['appearance'];

interface RankingAppearanceFormProps {
  readonly copy: AppearanceCopy;
  readonly appearance: RankingAppearance;
  readonly action?: (formData: FormData) => Promise<void>;
}

/**
 * Normalized form component for managing public scoreboard appearance.
 * Writes directly to the database via `saveRankingAppearance` and surfaces
 * feedback via standard Sonner toasts. Supports server action for progressive enhancement.
 */
export function RankingAppearanceForm({
  copy,
  appearance,
  action,
}: RankingAppearanceFormProps): React.JSX.Element {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setLoading(true);

    try {
      const result = await saveRankingAppearance(formData);
      if (result.success) {
        toast.success(copy.save, {
          description: copy.title,
        });
      } else {
        toast.error('Save failed', {
          description: result.error ?? 'Could not update appearance',
        });
      }
    } catch (error) {
      toast.error('Save failed', {
        description: (error as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form action={action} onSubmit={handleSubmit} className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.title}
      </Text>

      <div className="space-y-1">
        <Input
          label={copy.displayNameField}
          name="displayName"
          defaultValue={appearance.displayName}
          placeholder="e.g. Official Contest Scoreboard"
        />
        <p className="text-xs text-muted-foreground">{copy.displayNameHint}</p>
      </div>

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

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="anonymous"
          defaultChecked={appearance.anonymous}
          className="size-4 accent-primary"
        />
        {copy.anonymousField}
      </label>

      <Input label={copy.footerField} name="footerText" defaultValue={appearance.footerText} />
      <Input label={copy.creditsField} name="creditsText" defaultValue={appearance.creditsText} />

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="positive" loading={loading || isPending}>
          {copy.save}
        </Button>
      </div>
    </form>
  );
}
