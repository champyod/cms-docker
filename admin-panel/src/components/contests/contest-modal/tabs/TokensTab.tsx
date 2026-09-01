'use client';

import { cn } from '@/lib/utils';
import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
import { UnlimitedNumberInput } from '../shared/UnlimitedNumberInput';
import type { ContestFormData, SetContestForm } from '../types';

interface TokensTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
}

function TokenModeField({ formData, setFormData }: Pick<TokensTabProps, 'formData' | 'setFormData'>) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Token Mode</label>
      <select
        value={formData.token_mode}
        onChange={(e) => setFormData({ ...formData, token_mode: e.target.value })}
        className={fieldClasses(false)}
      >
        <option value="disabled">Disabled</option>
        <option value="finite">Finite</option>
        <option value="infinite">Infinite</option>
      </select>
      <p className="mt-1 text-xs text-muted-foreground">
          {formData.token_mode === 'disabled' && "Users cannot use tokens."}
          {formData.token_mode === 'finite' && "Users receive tokens periodically."}
          {formData.token_mode === 'infinite' && "Users have unlimited tokens (but subject to min interval)."}
      </p>
    </div>
  );
}

function MaxTotalTokensField(props: TokensTabProps) {
  const { formData, setFormData, validationErrors } = props;
  return (
    <div className="space-y-2">
      <label className={cn(LABEL_CLASSES, 'flex items-center justify-between')}>
          Max Total Tokens
          <span className="text-xs font-normal normal-case text-muted-foreground">Total allowed across contest</span>
      </label>
      <UnlimitedNumberInput
        value={formData.token_max_number}
        onChangeValue={(v) => setFormData({ ...formData, token_max_number: v })}
        hasError={validationErrors.has('token_max_number')}
      />
      <ErrorText errors={validationErrors} field="token_max_number" />
    </div>
  );
}

function MinIntervalField({
  field,
  label,
  formData,
  setFormData,
  validationErrors,
}: TokensTabProps & { field: 'token_min_interval'; label: string }) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>{label}</label>
      <input
        type="number"
        value={formData[field]}
        onChange={(e) => setFormData({ ...formData, [field]: parseInt(e.target.value) || 0 })}
        className={fieldClasses(validationErrors.has(field))}
      />
      <ErrorText errors={validationErrors} field={field} />
    </div>
  );
}

function InitialTokensField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className={LABEL_CLASSES}>Initial Tokens</label>
        <input
          type="number"
          value={formData.token_gen_initial}
          onChange={(e) => setFormData({ ...formData, token_gen_initial: parseInt(e.target.value) || 0 })}
          className={fieldClasses(validationErrors.has('token_gen_initial'))}
        />
        <ErrorText errors={validationErrors} field="token_gen_initial" />
    </div>
  );
}

function GenAmountField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className={LABEL_CLASSES}>Gen Amount</label>
        <input
          type="number"
          value={formData.token_gen_number}
          onChange={(e) => setFormData({ ...formData, token_gen_number: parseInt(e.target.value) || 0 })}
          className={fieldClasses(validationErrors.has('token_gen_number'))}
        />
        <ErrorText errors={validationErrors} field="token_gen_number" />
    </div>
  );
}

function GenIntervalField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className={LABEL_CLASSES}>Gen Interval (min)</label>
        <input
          type="number"
          value={formData.token_gen_interval}
          onChange={(e) => setFormData({ ...formData, token_gen_interval: parseInt(e.target.value) || 0 })}
          className={fieldClasses(validationErrors.has('token_gen_interval'))}
        />
        <ErrorText errors={validationErrors} field="token_gen_interval" />
    </div>
  );
}

function GenMaxCapField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className={LABEL_CLASSES}>Gen Max Cap</label>
        <UnlimitedNumberInput
          value={formData.token_gen_max}
          onChangeValue={(v) => setFormData({ ...formData, token_gen_max: v })}
          hasError={validationErrors.has('token_gen_max')}
        />
        <ErrorText errors={validationErrors} field="token_gen_max" />
    </div>
  );
}

function FiniteOnlyFields(props: TokensTabProps) {
  return (
    <>
        <div className="col-span-2 my-2 border-t border-border"></div>
        <InitialTokensField {...props} />
        <GenAmountField {...props} />
        <GenIntervalField {...props} />
        <GenMaxCapField {...props} />
    </>
  );
}

function TokenConfigFields(props: TokensTabProps) {
  const { formData } = props;
  return (
    <div className="grid animate-in fade-in grid-cols-2 gap-6 duration-300">

      {/* Common fields for Finite and Infinite */}
      <MaxTotalTokensField {...props} />

      <MinIntervalField {...props} field="token_min_interval" label="Min Interval (sec)" />

      {/* Finite-only fields */}
      {formData.token_mode === 'finite' && (
        <FiniteOnlyFields {...props} />
      )}
    </div>
  );
}

export function TokensTab({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      {/* TOKENS TAB */}
      <TokenModeField formData={formData} setFormData={setFormData} />

      {formData.token_mode !== 'disabled' && (
        <TokenConfigFields formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
      )}
    </div>
  );
}
