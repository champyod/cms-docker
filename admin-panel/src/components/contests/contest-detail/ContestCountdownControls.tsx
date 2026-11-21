'use client';

import { memo } from 'react';
import { ArrowLeftIcon, MaximizeIcon, MinimizeIcon, PauseIcon, PlayIcon } from 'lucide-animated';
import {
  COUNTDOWN_THRESHOLD_UNITS,
  type CountdownThreshold,
  type CountdownThresholdUnit,
} from '@/lib/contest-countdown';
import { CountdownIconButton } from './CountdownIconButton';
import { ContestCountdownTimezoneMenu } from './ContestCountdownTimezoneMenu';

const THRESHOLD_UNIT_LABELS: Readonly<Record<CountdownThresholdUnit, string>> = {
  seconds: 'sec',
  minutes: 'min',
  hours: 'hr',
  percent: '%',
};

interface ThresholdFieldProps {
  threshold: CountdownThreshold;
  onChange: (next: CountdownThreshold) => void;
}

/** Asks for the hurry window on the page itself: an amount plus sec/min/hr/%. */
export const CountdownThresholdField = memo(function CountdownThresholdField({
  threshold,
  onChange,
}: ThresholdFieldProps): React.JSX.Element {
  const changeAmount = (event: React.ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...threshold, amount: event.target.valueAsNumber });
  };
  const changeUnit = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const unit = COUNTDOWN_THRESHOLD_UNITS.find((candidate) => candidate === event.target.value);
    if (unit) onChange({ ...threshold, unit });
  };
  const selectAmount = (event: React.FocusEvent<HTMLInputElement>): void => {
    event.currentTarget.select();
  };
  const selectAmountOnClick = (event: React.MouseEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    if (input.selectionStart === input.selectionEnd) input.select();
  };
  return (
    <label className="countdown-threshold" title="Warn me this far ahead">
      <span className="sr-only">Hurry warning window</span>
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(threshold.amount) ? threshold.amount : ''}
        onChange={changeAmount}
        onFocus={selectAmount}
        onClick={selectAmountOnClick}
        className="countdown-threshold-input"
      />
      <select value={threshold.unit} onChange={changeUnit} className="countdown-threshold-unit">
        {COUNTDOWN_THRESHOLD_UNITS.map((unit) => (
          <option key={unit} value={unit}>{THRESHOLD_UNIT_LABELS[unit]}</option>
        ))}
      </select>
    </label>
  );
});

interface ToolbarProps {
  onBack: () => void;
  threshold: CountdownThreshold;
  onThresholdChange: (next: CountdownThreshold) => void;
  timezone: string;
  onTimezoneChange: (timeZone: string) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isPaused: boolean;
  onTogglePaused: () => void;
}

/** Page chrome: leave, warn window, zone, motion, full screen. */
export const CountdownToolbar = memo(function CountdownToolbar({
  onBack,
  threshold,
  onThresholdChange,
  timezone,
  onTimezoneChange,
  isFullscreen,
  onToggleFullscreen,
  isPaused,
  onTogglePaused,
}: ToolbarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CountdownIconButton label="Back" onClick={onBack}>
        <ArrowLeftIcon size={18} animateOnHover />
      </CountdownIconButton>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CountdownThresholdField threshold={threshold} onChange={onThresholdChange} />
        <ContestCountdownTimezoneMenu value={timezone} onChange={onTimezoneChange} />
        <CountdownIconButton label={isPaused ? 'Resume motion' : 'Pause motion'} onClick={onTogglePaused}>
          {isPaused ? <PlayIcon size={18} animateOnHover /> : <PauseIcon size={18} animateOnHover />}
        </CountdownIconButton>
        <CountdownIconButton label={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullscreen}>
          {isFullscreen ? <MinimizeIcon size={18} animateOnHover /> : <MaximizeIcon size={18} animateOnHover />}
        </CountdownIconButton>
      </div>
    </div>
  );
});
