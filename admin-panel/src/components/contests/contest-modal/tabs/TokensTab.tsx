'use client';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { Input } from '@/components/core/Input';
import { LimitField } from '@/components/core/LimitField';
import { Select, type SelectOption } from '@/components/core/Select';
import { useDictionary } from '@/hooks/useDictionary';
import type { ContestFormData, SetContestForm } from '../types';

const TOKEN_MODES: readonly SelectOption[] = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'finite', label: 'Finite' },
  { value: 'infinite', label: 'Infinite' },
];

interface TokensTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
}

function TokenModeField({ formData, setFormData }: Pick<TokensTabProps, 'formData' | 'setFormData'>): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Select
        label="Token Mode"
        value={formData.token_mode}
        onChange={(event) => setFormData({ ...formData, token_mode: event.target.value })}
        options={TOKEN_MODES}
      />
      <p className="mt-1 text-xs text-muted-foreground">
          {formData.token_mode === 'disabled' && "Users cannot use tokens."}
          {formData.token_mode === 'finite' && "Users receive tokens periodically."}
          {formData.token_mode === 'infinite' && "Users have unlimited tokens (but subject to min interval)."}
      </p>
    </div>
  );
}

function MaxTotalTokensField(props: TokensTabProps): React.JSX.Element {
  const { formData, setFormData, validationErrors } = props;
  const limits = useDictionary().limits;
  return (
    <LimitField
      id="token_max_number"
      label={limits.fields.token_max_number}
      hint={limits.hints.token_max_number}
      value={formData.token_max_number}
      onChangeValue={(v) => setFormData({ ...formData, token_max_number: v })}
      error={validationErrors.get('token_max_number')}
      unlimitedLabel={limits.unlimited}
    />
  );
}

function MinIntervalField({
  field,
  label,
  formData,
  setFormData,
  validationErrors,
}: TokensTabProps & { field: 'token_min_interval'; label: string }): React.JSX.Element {
  return (
    <Input
      type="number"
      label={label}
      value={formData[field]}
      onChange={(event) => setFormData({ ...formData, [field]: parseInt(event.target.value) || 0 })}
      error={validationErrors.get(field)}
    />
  );
}

function InitialTokensField({ formData, setFormData, validationErrors }: TokensTabProps): React.JSX.Element {
  return (
    <Input
      type="number"
      label="Initial Tokens"
      value={formData.token_gen_initial}
      onChange={(event) => setFormData({ ...formData, token_gen_initial: parseInt(event.target.value) || 0 })}
      error={validationErrors.get('token_gen_initial')}
    />
  );
}

function GenAmountField({ formData, setFormData, validationErrors }: TokensTabProps): React.JSX.Element {
  return (
    <Input
      type="number"
      label="Gen Amount"
      value={formData.token_gen_number}
      onChange={(event) => setFormData({ ...formData, token_gen_number: parseInt(event.target.value) || 0 })}
      error={validationErrors.get('token_gen_number')}
    />
  );
}

function GenIntervalField({ formData, setFormData, validationErrors }: TokensTabProps): React.JSX.Element {
  return (
    <Input
      type="number"
      label="Gen Interval (min)"
      value={formData.token_gen_interval}
      onChange={(event) => setFormData({ ...formData, token_gen_interval: parseInt(event.target.value) || 0 })}
      error={validationErrors.get('token_gen_interval')}
    />
  );
}

function GenMaxCapField({ formData, setFormData, validationErrors }: TokensTabProps): React.JSX.Element {
  const limits = useDictionary().limits;
  return (
    <LimitField
      id="token_gen_max"
      label={limits.fields.token_gen_max}
      hint={limits.hints.token_gen_max}
      value={formData.token_gen_max}
      onChangeValue={(v) => setFormData({ ...formData, token_gen_max: v })}
      error={validationErrors.get('token_gen_max')}
      unlimitedLabel={limits.unlimited}
    />
  );
}

function FiniteOnlyFields(props: TokensTabProps): React.JSX.Element {
  return (
    <>
        <div className="col-span-full my-2 border-t border-border"></div>
        <InitialTokensField {...props} />
        <GenAmountField {...props} />
        <GenIntervalField {...props} />
        <GenMaxCapField {...props} />
    </>
  );
}

function TokenConfigFields(props: TokensTabProps): React.JSX.Element {
  const { formData } = props;
  return (
    <div className="grid animate-in fade-in grid-cols-1 gap-6 duration-300 md:grid-cols-2">
      <MaxTotalTokensField {...props} />

      <MinIntervalField {...props} field="token_min_interval" label="Min Interval (sec)" />
      {formData.token_mode === 'finite' && (
        <FiniteOnlyFields {...props} />
      )}
    </div>
  );
}

export function TokensTab({ formData, setFormData, validationErrors }: TokensTabProps): React.JSX.Element {
  const limits = useDictionary().limits;
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      <TokenModeField formData={formData} setFormData={setFormData} />

      {formData.token_mode !== 'disabled' && (
        <TokenConfigFields formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
      )}

      {/* Why here: the two token caps are the limit fields this tab owns, so this is the button that pushes them to tasks. */}
      <div className="flex justify-end">
        <ApplyLimitsButton
          kinds={['task']}
          label={limits.apply.openButton}
          patch={{
            token_max_number: formData.token_max_number,
            token_gen_max: formData.token_gen_max,
          }}
        />
      </div>
    </div>
  );
}
