'use client';

import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import { ModalFooter } from '@/components/core/ModalFooter';
import type { ServiceRecord } from '@/lib/service-wiring-contract';
import { FIELDS, KIND_LABEL, type ContestOption, type Draft, type FieldSpec, type Kind } from './registry-spec';

interface RegistryEntryDialogProps {
  kind: Kind | null;
  draft: Draft;
  pending: boolean;
  contests: ContestOption[];
  services: ServiceRecord[];
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function RegistryEntryDialog({
  kind,
  draft,
  pending,
  contests,
  services,
  onChange,
  onClose,
  onSubmit,
}: RegistryEntryDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={kind !== null}
      pending={pending}
      onOpenChange={(next): void => { if (!next) onClose(); }}
      title={kind === null ? '' : KIND_LABEL[kind]}
      footer={
        <ModalFooter
          cancelLabel="Cancel"
          confirmLabel="Save"
          confirmLoading={pending}
          onCancel={onClose}
          onConfirm={onSubmit}
        />
      }
    >
      <div className="space-y-3">
        {kind !== null && FIELDS[kind].map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? ''}
            contests={contests}
            services={services}
            onChange={(value): void => onChange(field.key, value)}
          />
        ))}
      </div>
    </Dialog>
  );
}

interface FieldInputProps {
  field: FieldSpec;
  value: string;
  contests: ContestOption[];
  services: ServiceRecord[];
  onChange: (value: string) => void;
}

function FieldInput({ field, value, contests, services, onChange }: FieldInputProps): React.JSX.Element {
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(event): void => onChange(String(event.target.checked))}
        />
        {field.label}
      </label>
    );
  }

  if (field.kind === 'select' || field.kind === 'contest' || field.kind === 'service') {
    return (
      <ChoiceField
        field={field}
        value={value}
        options={optionsFor(field, contests, services)}
        onChange={onChange}
      />
    );
  }

  return (
    <Input
      label={field.label}
      value={value}
      inputMode={field.kind === 'number' ? 'numeric' : undefined}
      onChange={(event): void => onChange(event.target.value)}
    />
  );
}

function optionsFor(
  field: FieldSpec,
  contests: ContestOption[],
  services: ServiceRecord[]
): Array<{ value: string; label: string }> {
  if (field.kind === 'contest') {
    return contests.map((contest) => ({ value: String(contest.id), label: `#${contest.id} ${contest.name}` }));
  }
  if (field.kind === 'service') {
    return services.map((service) => ({ value: String(service.id), label: service.name }));
  }
  return (field.options ?? []).map((option) => ({ value: option, label: option }));
}

interface ChoiceFieldProps {
  field: FieldSpec;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function ChoiceField({ field, value, options, onChange }: ChoiceFieldProps): React.JSX.Element {
  return (
    <label className="block text-sm text-foreground">
      <span className="mb-1 block text-muted-foreground">{field.label}</span>
      <select
        className="w-full rounded-xl border border-border bg-background px-3 py-2"
        value={value}
        onChange={(event): void => onChange(event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
