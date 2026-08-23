'use client';

import { cn } from '@/lib/utils';
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
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Token Mode</label>
      <select
        value={formData.token_mode}
        onChange={(e) => setFormData({ ...formData, token_mode: e.target.value })}
        className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-white focus:ring-1 focus:ring-indigo-500/50"
      >
        <option value="disabled">Disabled</option>
        <option value="finite">Finite</option>
        <option value="infinite">Infinite</option>
      </select>
      <p className="text-xs text-neutral-500 mt-1">
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
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center justify-between">
          Max Total Tokens
          <span className="text-[10px] normal-case font-normal text-neutral-400">Total allowed across contest</span>
      </label>
      <UnlimitedNumberInput
        value={formData.token_max_number}
        onChangeValue={(v) => setFormData({ ...formData, token_max_number: v })}
        hasError={validationErrors.has('token_max_number')}
      />
      {validationErrors.has('token_max_number') && (
        <p className="text-xs text-red-500">{validationErrors.get('token_max_number')}</p>
      )}
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
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">{label}</label>
      <input
        type="number"
        value={formData[field]}
        onChange={(e) => setFormData({ ...formData, [field]: parseInt(e.target.value) || 0 })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
          validationErrors.has(field) ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has(field) && (
        <p className="text-xs text-red-500">{validationErrors.get(field)}</p>
      )}
    </div>
  );
}

function InitialTokensField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Initial Tokens</label>
        <input
          type="number"
          value={formData.token_gen_initial}
          onChange={(e) => setFormData({ ...formData, token_gen_initial: parseInt(e.target.value) || 0 })}
          className={cn(
            "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
            validationErrors.has('token_gen_initial') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
          )}
        />
        {validationErrors.has('token_gen_initial') && (
          <p className="text-xs text-red-500">{validationErrors.get('token_gen_initial')}</p>
        )}
    </div>
  );
}

function GenAmountField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Gen Amount</label>
        <input
          type="number"
          value={formData.token_gen_number}
          onChange={(e) => setFormData({ ...formData, token_gen_number: parseInt(e.target.value) || 0 })}
          className={cn(
            "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
            validationErrors.has('token_gen_number') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
          )}
        />
        {validationErrors.has('token_gen_number') && (
          <p className="text-xs text-red-500">{validationErrors.get('token_gen_number')}</p>
        )}
    </div>
  );
}

function GenIntervalField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Gen Interval (min)</label>
        <input
          type="number"
          value={formData.token_gen_interval}
          onChange={(e) => setFormData({ ...formData, token_gen_interval: parseInt(e.target.value) || 0 })}
          className={cn(
            "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
            validationErrors.has('token_gen_interval') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
          )}
        />
        {validationErrors.has('token_gen_interval') && (
          <p className="text-xs text-red-500">{validationErrors.get('token_gen_interval')}</p>
        )}
    </div>
  );
}

function GenMaxCapField({ formData, setFormData, validationErrors }: TokensTabProps) {
  return (
    <div className="space-y-2">
        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Gen Max Cap</label>
        <UnlimitedNumberInput
          value={formData.token_gen_max}
          onChangeValue={(v) => setFormData({ ...formData, token_gen_max: v })}
          hasError={validationErrors.has('token_gen_max')}
        />
        {validationErrors.has('token_gen_max') && (
          <p className="text-xs text-red-500">{validationErrors.get('token_gen_max')}</p>
        )}
    </div>
  );
}

function FiniteOnlyFields(props: TokensTabProps) {
  return (
    <>
        <div className="col-span-2 border-t border-white/5 my-2"></div>
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
    <div className="grid grid-cols-2 gap-6 animate-in fade-in duration-300">

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
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* TOKENS TAB */}
      <TokenModeField formData={formData} setFormData={setFormData} />

      {formData.token_mode !== 'disabled' && (
        <TokenConfigFields formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
      )}
    </div>
  );
}
