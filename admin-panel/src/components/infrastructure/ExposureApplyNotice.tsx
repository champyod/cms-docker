'use client';

import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import type { ExposureApplyOutcome } from '@/app/actions/exposureApply';

/** What the last exposure save answered, and the row it was about. */
export interface ExposureApplyReport {
  readonly label: string;
  readonly outcome: ExposureApplyOutcome;
  readonly error?: string;
}

type ApplyCopy = ReturnType<typeof useDictionary>['infrastructure']['services']['apply'];

const TITLE_KEY: Record<ExposureApplyOutcome, keyof ApplyCopy> = {
  applied: 'applied',
  'refused-validation': 'refusedValidation',
  'refused-nginx': 'refusedNginx',
  refused: 'refused',
};

/**
 * The front's verdict beside the exposure it was about.
 *
 * WHY the row's own label in the strip: several exposures share one table, and a strip that said only
 * "refused by nginx" would leave the operator guessing which save it answered.
 */
export function ExposureApplyNotice({ report }: { readonly report: ExposureApplyReport | null }): React.JSX.Element | null {
  const copy = useDictionary().infrastructure.services;
  if (report === null) return null;
  const applied = report.outcome === 'applied';
  const message = applied
    ? interpolate(copy.apply.appliedMessage, { label: report.label })
    : interpolate(copy.apply.refusedMessage, { label: report.label, message: report.error ?? '' });
  return (
    <InlineAlert tone={applied ? 'success' : 'destructive'} title={copy.apply[TITLE_KEY[report.outcome]]} density="compact">
      {message}
    </InlineAlert>
  );
}
