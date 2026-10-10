'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { ContestCountdownData } from '@/lib/queries/contest-detail';
import {
  DEFAULT_COUNTDOWN_THRESHOLD,
  STAGE_LABELS,
  countdownPhaseWindowMs,
  countdownTarget,
  formatZoneTime,
  resolveContestPhase,
  resolveCountdownStage,
  resolveHurryThresholdMs,
  resolveRunnerSpeedPxPerSecond,
  type ContestPhase,
  type ContestTimingWindow,
} from '@/lib/contest-countdown';
import { ContestCountdownClock } from './ContestCountdownClock';
import { CountdownToolbar } from './ContestCountdownControls';
import { ContestCountdownRunner } from './ContestCountdownRunner';
import {
  useContestMotion,
  useCountdownThreshold,
  useCountdownTiming,
  useCountdownTimezone,
  useElementFullscreen,
  usePhaseNotifications,
} from './useContestCountdown';
import {
  DEFAULT_CONTEST_PANIC_CONFIG,
  panicClassNames,
  shouldPanic,
} from '@/lib/contest-panic';

/** The panic pace as a custom property, so animate.css's own base rule reads it. */
function panicStyle(): React.CSSProperties & Record<'--animate-duration', string> {
  return { '--animate-duration': `${DEFAULT_CONTEST_PANIC_CONFIG.durationSeconds}s` };
}

const DEFAULT_HURRY_MS = resolveHurryThresholdMs(DEFAULT_COUNTDOWN_THRESHOLD, 0);

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
  const { threshold, setThreshold } = useCountdownThreshold();
  const { isFullscreen, toggle: toggleFullscreen } = useElementFullscreen(surfaceRef);
  const { isPaused, togglePaused } = useContestMotion();

  const phase = resolveContestPhase(timing, now);
  const target = countdownTarget(timing, phase);
  const remainingMs = target ? target.getTime() - now.getTime() : null;
  const windowMs = countdownPhaseWindowMs(timing, phase, DEFAULT_HURRY_MS);
  const stage = resolveCountdownStage(phase, remainingMs, resolveHurryThresholdMs(threshold, windowMs));
  const isPanicking = shouldPanic(stage, isPaused);
  usePhaseNotifications(timing.name, phase);

  const goBack = useCallback((): void => router.back(), [router]);

  return (
    <div
      ref={surfaceRef}
      data-stage={stage}
      data-phase={phase}
      className="countdown-surface relative isolate flex min-h-[62vh] flex-col gap-6 overflow-hidden"
    >
      <div aria-hidden className="countdown-backdrop">
        <span className="countdown-blob" />
        <span className="countdown-blob" />
        <span className="countdown-blob" />
      </div>
      {stage === 'hurry' ? <div aria-hidden className="countdown-warning" /> : null}
      <ContestCountdownRunner speedPxPerSecond={resolveRunnerSpeedPxPerSecond(remainingMs, windowMs)} />

      <div className="relative z-10">
        <CountdownToolbar
          onBack={goBack}
          threshold={threshold}
          onThresholdChange={setThreshold}
          timezone={timezone}
          onTimezoneChange={setTimezone}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          isPaused={isPaused}
          onTogglePaused={togglePaused}
        />
      </div>

      <div className="countdown-clock-fill relative z-10 flex flex-1 flex-col justify-center gap-4 text-center">
        <div className={cn('countdown-clock-panic', ...panicClassNames(isPanicking))} style={panicStyle()}>
          <ContestCountdownClock remainingMs={remainingMs} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <span className="countdown-stage-label">{STAGE_LABELS[stage]}</span>
          <span className="text-sm text-muted-foreground">{describeMoment(timing, phase, timezone)}</span>
        </div>
      </div>
    </div>
  );
}
