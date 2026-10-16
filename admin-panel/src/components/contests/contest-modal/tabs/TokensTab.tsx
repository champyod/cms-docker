'use client';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { LimitField } from '@/components/core/LimitField';
import { useDictionary } from '@/hooks/useDictionary';
import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
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

function FiniteOnlyFields(props: TokensTabProps) {
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

function TokenConfigFields(props: TokensTabProps) {
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

export function TokensTab({ formData, setFormData, validationErrors }: TokensTabProps) {
  const limits = useDictionary().limits;
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      <TokenModeField formData={formData} setFormData={setFormData} />

      {formData.token_mode !== 'disabled' && (
        <TokenConfigFields formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
      )}

      {/* Why here: the two token caps are the limit fields this tab owns, so this is the button that
          pushes them to the other kind (tasks). */}
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
