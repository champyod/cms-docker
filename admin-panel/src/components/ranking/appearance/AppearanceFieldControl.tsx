'use client';

import { Input } from '@/components/core/Input';
import { SelectField, TextareaField } from '@/components/core/FormField';

import type { AppearanceField } from './appearanceSchema';

export type AppearanceValue = string | boolean;

interface AppearanceFieldControlProps {
  readonly field: AppearanceField;
  readonly value: AppearanceValue;
  readonly disabled: boolean;
  readonly onChange: (name: AppearanceField['name'], value: AppearanceValue) => void;
}

function asText(value: AppearanceValue): string {
  return typeof value === 'string' ? value : '';
}

const JSON_ROWS = 8;

/**
 * One control chosen by the descriptor's kind, bound to the form's own state.
 *
 * WHY every control is controlled here and not seeded with `defaultValue`: the value the
 * server last held is not an input's value while the operator is editing it, so a
 * re-render that re-applies it would overwrite what they typed. The form owns the text
 * and the server re-seeds it only after a write.
 */
export function AppearanceFieldControl({
  field,
  value,
  disabled,
  onChange,
}: AppearanceFieldControlProps): React.JSX.Element {
  const id = `appearance-${field.name}`;
  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          id={id}
          type="checkbox"
          name={field.name}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(field.name, event.target.checked)}
          className="size-4 accent-primary"
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === 'select') {
    return (
      <SelectField
        id={id}
        label={field.label}
        hint={field.hint}
        name={field.name}
        value={asText(value)}
        disabled={disabled}
        onChange={(event) => onChange(field.name, event.target.value)}
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
        id={id}
        label={field.label}
        hint={field.hint}
        name={field.name}
        rows={JSON_ROWS}
        value={asText(value)}
        disabled={disabled}
        onChange={(event) => onChange(field.name, event.target.value)}
        className="font-mono"
      />
    );
  }
  // Input renders its own label and wraps the adapter input, so the field's own
  // id, name and hint association come from it rather than from a second wrapper.
  return (
    <Input
      id={id}
      label={field.label}
      name={field.name}
      value={asText(value)}
      disabled={disabled}
      onChange={(event) => onChange(field.name, event.target.value)}
    />
  );
}
