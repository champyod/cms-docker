'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, MaximizeIcon, MinimizeIcon } from 'lucide-animated';
import type { ContestCountdownData } from '@/lib/queries/contest-detail';
import {
  PHASE_LABELS,
  countdownTarget,
  formatZoneTime,
  resolveContestPhase,
  type ContestPhase,
  type ContestTimingWindow,
} from '@/lib/contest-countdown';
import { Badge } from '@/components/core/Badge';
import { ContestCountdownClock } from './ContestCountdownClock';
import { ContestCountdownTimezoneMenu, CountdownIconButton } from './ContestCountdownControls';
import {
  useCountdownTiming,
  useCountdownTimezone,
  useElementFullscreen,
  usePhaseNotifications,
} from './useContestCountdown';

const PHASE_VARIANTS: Readonly<Record<ContestPhase, 'neutral' | 'success' | 'info' | 'destructive'>> = {
  not_started: 'neutral',
  running: 'success',
  analysis: 'info',
  ended: 'destructive',
};

const PHASE_MOMENT_VERBS: Readonly<Record<ContestPhase, string>> = {
  not_started: 'Starts',
  running: 'Ends',
  analysis: 'Analysis ends',
  ended: 'Ended',
};

/** The moment the current phase runs to, rendered in the chosen zone. */
function describeMoment(timing: ContestTimingWindow, phase: ContestPhase, timeZone: string): string {
  const instant = countdownTarget(timing, phase) ?? (timing.stop ? new Date(timing.stop) : null);
  if (!instant) return phase === 'ended' ? 'This contest has ended' : 'No start time configured';
  return `${PHASE_MOMENT_VERBS[phase]} ${formatZoneTime(instant, timeZone)}`;
}

export function ContestCountdownTab({ data }: { data: ContestCountdownData }): React.JSX.Element {
  const router = useRouter();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { timing, now } = useCountdownTiming(data);
  const { timezone, setTimezone } = useCountdownTimezone();
  const { isFullscreen, toggle: toggleFullscreen } = useElementFullscreen(surfaceRef);

  const phase = resolveContestPhase(timing, now);
  const target = countdownTarget(timing, phase);
  const remainingMs = target ? target.getTime() - now.getTime() : null;
  usePhaseNotifications(timing.name, phase);

  const goBack = useCallback((): void => router.back(), [router]);

  return (
    <div ref={surfaceRef} className="countdown-surface flex min-h-[62vh] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <CountdownIconButton label="Back" onClick={goBack}>
          <ArrowLeftIcon size={18} animateOnHover />
        </CountdownIconButton>
        <div className="flex items-center gap-2">
          <ContestCountdownTimezoneMenu value={timezone} onChange={setTimezone} />
          <CountdownIconButton label={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
            {isFullscreen ? <MinimizeIcon size={18} animateOnHover /> : <MaximizeIcon size={18} animateOnHover />}
          </CountdownIconButton>
        </div>
      </div>

      <div className="countdown-clock-fill flex flex-1 flex-col justify-center gap-4 text-center">
        <ContestCountdownClock remainingMs={remainingMs} />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Badge
            variant={PHASE_VARIANTS[phase]}
            className={phase === 'not_started' || phase === 'running' ? 'animate-pulse' : undefined}
          >
            {PHASE_LABELS[phase]}
          </Badge>
          <span className="text-sm text-muted-foreground">{describeMoment(timing, phase, timezone)}</span>
        </div>
      </div>
    </div>
  );
}
