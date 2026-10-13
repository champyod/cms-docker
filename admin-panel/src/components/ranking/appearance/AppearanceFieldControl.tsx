import { Input } from '@/components/core/Input';
import { SelectField, TextareaField } from '@/components/core/FormField';

import type { AppearanceField } from './appearanceSchema';

export type AppearanceValue = string | boolean;

interface AppearanceFieldControlProps {
  readonly field: AppearanceField;
  readonly value: AppearanceValue;
}

function asText(value: AppearanceValue): string {
  return typeof value === 'string' ? value : '';
}

const JSON_ROWS = 8;

/**
 * One control chosen by the descriptor's kind. Every branch posts the field's own name,
 * so the action reads the same keys the page rendered.
 */
export function AppearanceFieldControl({
  field,
  value,
}: AppearanceFieldControlProps): React.JSX.Element {
  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name={field.name}
          defaultChecked={value === true}
          className="size-4 accent-primary"
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === 'select') {
    return (
      <SelectField
        id={`appearance-${field.name}`}
        label={field.label}
        hint={field.hint}
        name={field.name}
        defaultValue={asText(value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
    );
  }
  if (field.kind === 'json') {
    return (
      <TextareaField
        id={`appearance-${field.name}`}
        label={field.label}
        hint={field.hint}
        name={field.name}
        rows={JSON_ROWS}
        defaultValue={asText(value)}
        className="font-mono"
      />
    );
  }
  return (
    <div className="space-y-1.5">
      <Input label={field.label} name={field.name} defaultValue={asText(value)} />
      {field.hint !== undefined && (
        <p className="ml-1 text-xs text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}
