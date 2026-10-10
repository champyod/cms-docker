'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlarmClock, Globe2, Timer } from 'lucide-react';
import { getContestCountdown } from '@/app/actions/contests';
import type { ContestCountdownData } from '@/lib/queries/contest-detail';
import {
  COUNTDOWN_TIMEZONES,
  DEFAULT_COUNTDOWN_TIMEZONE,
  PHASE_LABELS,
  countdownTarget,
  formatCountdown,
  formatZoneTime,
  resolveContestPhase,
  zoneOffsetLabel,
  type ContestPhase,
} from '@/lib/contest-countdown';
import { Badge } from '@/components/core/Badge';
import { Card } from '@/components/core/Card';

const TICK_MS = 1000;
const CONFIG_POLL_MS = 15000;
const ALERT_TOAST_MS = 10000;
const TIMEZONE_STORAGE_KEY = 'contest-countdown-timezone';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs tabular-nums';

type PhaseVariant = 'neutral' | 'success' | 'info' | 'destructive';

const PHASE_VARIANTS: Readonly<Record<ContestPhase, PhaseVariant>> = {
  not_started: 'neutral',
  running: 'success',
  analysis: 'info',
  ended: 'destructive',
};

const TARGET_LABELS: Readonly<Record<ContestPhase, string>> = {
  not_started: 'until the contest starts',
  running: 'until the contest ends',
  analysis: 'until analysis mode closes',
  ended: '',
};

interface Props { data: ContestCountdownData }

export function ContestCountdownTab({ data }: Props): React.JSX.Element {
  const [timing, setTiming] = useState(data);
  const [now, setNow] = useState(() => new Date());
  const [timezone, setTimezone] = useState(DEFAULT_COUNTDOWN_TIMEZONE);

  const phase = resolveContestPhase(timing, now);
  const target = countdownTarget(timing, phase);
  const remainingMs = target ? target.getTime() - now.getTime() : null;

  const zoneOptions = useMemo(
    () => COUNTDOWN_TIMEZONES.map((zone) => ({ zone, offset: zoneOffsetLabel(zone) })),
    [],
  );

  // Why: a one-second tick keeps the displayed digits live; the
  // config poll below is what actually hot-reloads edited times.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Why: polling the server action re-reads the timing columns, so a
  // start time edited in Overview or Settings reaches this page without
  // a manual refresh.
  useEffect(() => {
    const contestId = timing.id;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const result = await getContestCountdown(contestId);
        if (!cancelled && result) setTiming(result);
      } catch (error: unknown) {
        console.warn('Countdown config poll failed:', error);
      }
    };
    const interval = window.setInterval(() => { void poll(); }, CONFIG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [timing.id]);

  // Why: the first render seeds the ref, so a notification only
  // fires on a real transition — into Running when the contest
  // starts, into Ended when it finishes.
  const previousPhase = useRef(phase);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (previous === phase) return;
    if (phase === 'running' && previous === 'not_started') {
      toast.success(`${timing.name} has started.`, { duration: ALERT_TOAST_MS });
    } else if (phase === 'ended' && previous !== 'ended') {
      toast(`${timing.name} has ended.`, { duration: ALERT_TOAST_MS });
    }
  }, [phase, timing.name]);

  // Why: the choice is admin preference, so it survives navigation.
  useEffect(() => {
    const saved = window.localStorage.getItem(TIMEZONE_STORAGE_KEY);
    if (saved && COUNTDOWN_TIMEZONES.includes(saved)) setTimezone(saved);
  }, []);

  const handleTimezoneChange = (next: string): void => {
    setTimezone(next);
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, next);
  };

  const endedDuration =
    phase === 'ended' && timing.start && timing.stop
      ? formatCountdown(new Date(timing.stop).getTime() - new Date(timing.start).getTime())
      : null;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-warning" />
            <span className="font-bold text-foreground">Contest Countdown</span>
          </div>
          <Badge variant={PHASE_VARIANTS[phase]} className={phase === 'not_started' || phase === 'running' ? 'animate-pulse' : undefined}>
            {PHASE_LABELS[phase]}
          </Badge>
        </div>

        <div className="mb-2 text-center">
          <AlarmClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <div className="font-mono text-6xl font-bold tabular-nums tracking-tight text-foreground">
            {remainingMs !== null ? formatCountdown(remainingMs) : '—'}
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            {remainingMs !== null
              ? TARGET_LABELS[phase]
              : phase === 'ended'
                ? 'This contest has ended'
                : 'No start time configured'}
          </div>
          {endedDuration ? (
            <div className="mt-1 text-sm text-muted-foreground">Total duration: {endedDuration}</div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TimingField label="Contest Start" value={timing.start ? formatZoneTime(new Date(timing.start), timezone) : 'Not configured'} />
          <TimingField label="Contest Stop" value={timing.stop ? formatZoneTime(new Date(timing.stop), timezone) : 'Not configured'} />
          <TimingField label="Analysis Start" value={timing.analysis_start ? formatZoneTime(new Date(timing.analysis_start), timezone) : 'Not configured'} />
          <TimingField label="Analysis Stop" value={timing.analysis_stop ? formatZoneTime(new Date(timing.analysis_stop), timezone) : 'Not configured'} />
          <TimingField label={`Current time (${zoneOffsetLabel(timezone)})`} value={formatZoneTime(now, timezone)} />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <label htmlFor="countdown-timezone" className="text-sm font-medium text-foreground">Timezone</label>
          <select
            id="countdown-timezone"
            value={timezone}
            onChange={(event) => handleTimezoneChange(event.target.value)}
            className={FIELD_CLASSES}
          >
            {zoneOptions.map((option) => (
              <option key={option.zone} value={option.zone}>
                {`${option.offset} — ${option.zone}`}
              </option>
            ))}
          </select>
        </div>
      </Card>
    </div>
  );
}

function TimingField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <span className={LABEL_CLASSES}>{label}</span>
      <span className="block px-3 py-2 text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}
