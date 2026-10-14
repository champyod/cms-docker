'use client';

import { useMemo, useState } from 'react';

import {
  DEFAULT_GENERATOR_LENGTH,
  generateRun,
  MAX_GENERATOR_LENGTH,
  MIN_GENERATOR_LENGTH,
  type CaseMode,
  type GeneratorConfig,
} from '@/lib/credential-template';
import { cn } from '@/lib/utils';

import { Dialog } from './Dialog';
import { ModalFooter } from './ModalFooter';

export interface GeneratorConfigDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  config: GeneratorConfig;
  onConfigChange(config: GeneratorConfig): void;
  /** Receives the accepted sample; the dialog closes itself afterwards. */
  onUse?(sample: string): void;
  /** Hides both symbol groups, for an alphabet that accepts letters and digits only. */
  symbolsAllowed?: boolean;
  /** Samples on open instead of waiting for a first Generate. */
  autoPreview?: boolean;
  previewPlaceholder?: string;
  generateLabel?: string;
  useLabel?: string;
  className?: string;
}

type ConfigPatch = (changes: Partial<GeneratorConfig>) => void;

const CASE_OPTIONS: ReadonlyArray<{ value: CaseMode; label: string }> = [
  { value: 'both', label: 'Both Upper + Lower' },
  { value: 'upper', label: 'Upper Only' },
  { value: 'lower', label: 'Lower Only' },
];

const FIELD_LABEL_CLASS = 'mb-2 block text-xs font-bold uppercase text-muted-foreground';
const FIELD_CLASS = 'w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-foreground';

function toCaseMode(value: string): CaseMode {
  return CASE_OPTIONS.find((option) => option.value === value)?.value ?? 'both';
}

function clampLength(raw: string): number {
  return Math.max(MIN_GENERATOR_LENGTH, Math.min(MAX_GENERATOR_LENGTH, Number(raw) || DEFAULT_GENERATOR_LENGTH));
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  className?: string;
}

function ConfigToggle({ label, checked, onChange, className }: ToggleProps): React.JSX.Element {
  return (
    <label className={cn('flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3', className)}>
      <span className="text-sm text-foreground">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function LengthField({ length, patch }: { length: number; patch: ConfigPatch }): React.JSX.Element {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>Length</label>
      <input
        type="number"
        min={MIN_GENERATOR_LENGTH}
        max={MAX_GENERATOR_LENGTH}
        value={length}
        onChange={(event) => patch({ length: clampLength(event.target.value) })}
        className={FIELD_CLASS}
      />
    </div>
  );
}

interface AlphabetTogglesProps {
  config: GeneratorConfig;
  patch: ConfigPatch;
  symbolsAllowed: boolean;
}

function AlphabetToggles({ config, patch, symbolsAllowed }: AlphabetTogglesProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ConfigToggle label="Letters" checked={config.letters} onChange={(letters) => patch({ letters })} />
      <ConfigToggle label="Numbers" checked={config.numbers} onChange={(numbers) => patch({ numbers })} />
      {symbolsAllowed && (
        <>
          <ConfigToggle
            label="Special symbols (@ # $ % ...)"
            checked={config.specials}
            onChange={(specials) => patch({ specials })}
            className="sm:col-span-2"
          />
          <ConfigToggle
            label="Operator symbols (- + = _ [ ] ?)"
            checked={config.operators}
            onChange={(operators) => patch({ operators })}
            className="sm:col-span-2"
          />
        </>
      )}
    </div>
  );
}

function CaseField({ config, patch }: { config: GeneratorConfig; patch: ConfigPatch }): React.JSX.Element {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>Letter Case</label>
      <select
        value={config.caseMode}
        onChange={(event) => patch({ caseMode: toCaseMode(event.target.value) })}
        disabled={!config.letters}
        className={cn(FIELD_CLASS, 'disabled:opacity-50')}
      >
        {CASE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewBox({ sample, placeholder }: { sample: string | null; placeholder: string }): React.JSX.Element {
  return (
    <div className="min-h-11 break-all rounded-lg border border-border bg-muted/50 p-3 text-sm text-primary">
      {sample ?? placeholder}
    </div>
  );
}

export function GeneratorConfigDialog({
  open,
  onOpenChange,
  title,
  config,
  onConfigChange,
  onUse,
  symbolsAllowed = true,
  autoPreview = false,
  previewPlaceholder = 'Press Generate to preview',
  generateLabel = 'Generate',
  useLabel = 'Use',
  className,
}: GeneratorConfigDialogProps): React.JSX.Element {
  const [runToken, setRunToken] = useState(0);
  const patch: ConfigPatch = (changes) => onConfigChange({ ...config, ...changes });

  // Why a memo and not an effect: a first Generate arms the sample, and a shown
  // sample then follows the config it was drawn from without a cascading render.
  const sample = useMemo(() => {
    if (runToken === 0 && !autoPreview) return null;
    return generateRun(config);
  }, [runToken, config, autoPreview]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className={className}
      footer={
        <ModalFooter
          cancelLabel={generateLabel}
          confirmLabel={useLabel}
          onCancel={() => setRunToken((token) => token + 1)}
          onConfirm={(): void => {
            if (sample !== null) onUse?.(sample);
            onOpenChange(false);
          }}
          confirmDisabled={sample === null}
        />
      }
    >
      <div className="space-y-4">
        <LengthField length={config.length} patch={patch} />
        <AlphabetToggles config={config} patch={patch} symbolsAllowed={symbolsAllowed} />
        <CaseField config={config} patch={patch} />
        <PreviewBox sample={sample} placeholder={previewPlaceholder} />
      </div>
    </Dialog>
  );
}
