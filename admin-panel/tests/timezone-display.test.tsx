// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { QuestionsPanel, type QuestionRow } from '@/components/contests/contest-communications/QuestionsPanel';
import {
  MISSING_TIMESTAMP,
  TimezoneProvider,
  useDisplayTimezone,
  useFormatDay,
  useFormatTimeOfDay,
  useFormatTimestamp,
} from '@/components/layout/TimezoneProvider';
import { formatInZone } from '@/lib/timezone';

// Why: globals are off in vitest.config.ts, so without this a later query would bind to the
// accumulated document.body.
afterEach(() => cleanup());

const ROME = 'Europe/Rome';
const TOKYO = 'Asia/Tokyo';
// Why this instant: 09:30Z is 10:30 in Rome (UTC+1 in January) and 18:30 in Tokyo (UTC+9), so the two
// zones disagree on the clock while agreeing on the day — a formatter that lost the zone would still
// look right on the date.
const INSTANT = '2026-01-15T09:30:00.000Z';
const ROME_DATETIME = '15/01/2026, 10:30:00';
const TOKYO_DATETIME = '15/01/2026, 18:30:00';

type ProbeKind = 'datetime' | 'day' | 'clock' | 'zone';

function runtimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function Probe({ kind, instant = INSTANT }: { kind: ProbeKind; instant?: string }): React.JSX.Element {
  const zone = useDisplayTimezone();
  const formatTimestamp = useFormatTimestamp();
  const formatDay = useFormatDay();
  const formatTimeOfDay = useFormatTimeOfDay();
  const value = kind === 'day' ? formatDay(instant)
    : kind === 'clock' ? formatTimeOfDay(instant)
      : kind === 'zone' ? zone
        : formatTimestamp(instant);
  return <span data-testid="probe">{value}</span>;
}

/** Renders the probe bare to mean "no contest owner", or under a provider seeded with `timezone`. */
function renderProbe(kind: ProbeKind, timezone?: string | null, instant?: string): string {
  const probe = <Probe kind={kind} instant={instant} />;
  const view = timezone === undefined
    ? render(probe)
    : render(<TimezoneProvider timezone={timezone}>{probe}</TimezoneProvider>);
  const text = view.getByTestId('probe').textContent ?? '';
  // Why the unmount: a test may read the probe more than once, and cleanup only runs per test.
  view.unmount();
  return text;
}

const QUESTION: QuestionRow = {
  id: 9,
  subject: 'Scoring',
  text: 'How is it scored?',
  ignored: false,
  reply_timestamp: null,
  reply_subject: null,
  reply_text: null,
  question_timestamp: INSTANT,
  participations: { users: { username: 'ada' } },
};

function questionPanel(): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <QuestionsPanel
        questions={[QUESTION]}
        replyingTo={null}
        replySubject=""
        replyText=""
        permissionKeys={['question:answer', 'question:ignore']}
        onReplyingTo={() => {}}
        onReplySubject={() => {}}
        onReplyText={() => {}}
        onReply={() => {}}
        onIgnore={() => {}}
      />
    </DictionaryProvider>
  );
}

describe('display zone with no contest owner', () => {
  it('resolves the runtime zone when nothing seeds a zone', () => {
    expect(renderProbe('zone')).toBe(runtimeZone());
  });

  it('renders an instant as the canonical browser-zone reading', () => {
    expect(renderProbe('datetime')).toBe(formatInZone(INSTANT));
  });

  it('treats a null owner zone the same as no provider at all', () => {
    expect(renderProbe('zone', null)).toBe(runtimeZone());
    expect(renderProbe('datetime', null)).toBe(formatInZone(INSTANT));
  });

  it('falls back to the runtime zone when the seeded zone is unusable', () => {
    expect(renderProbe('zone', 'Not/AZone')).toBe(runtimeZone());
  });
});

describe('display zone seeded by the owning contest', () => {
  it('renders the contest wall clock for a datetime surface', () => {
    expect(renderProbe('datetime', ROME)).toBe(ROME_DATETIME);
  });

  it('renders the contest wall clock for a date-only surface', () => {
    expect(renderProbe('day', ROME)).toBe('15/01/2026');
  });

  it('renders the contest wall clock for a time-only surface', () => {
    expect(renderProbe('clock', ROME)).toBe('10:30');
  });

  it('re-renders in the new zone when the provider is re-seeded', () => {
    const view = render(
      <TimezoneProvider timezone={ROME}>
        <Probe kind="datetime" />
      </TimezoneProvider>,
    );
    expect(view.getByTestId('probe').textContent).toBe(ROME_DATETIME);
    view.rerender(
      <TimezoneProvider timezone={TOKYO}>
        <Probe kind="datetime" />
      </TimezoneProvider>,
    );
    expect(view.getByTestId('probe').textContent).toBe(TOKYO_DATETIME);
  });
});

describe('instants a payload cannot carry', () => {
  it('renders the documented fallback for an unparsable instant', () => {
    const rendered = renderProbe('datetime', ROME, 'not-a-date');
    expect(rendered).toBe(MISSING_TIMESTAMP);
    expect(rendered).not.toContain('Invalid Date');
  });

  it('renders the same fallback for an empty instant', () => {
    expect(renderProbe('datetime', ROME, '')).toBe(MISSING_TIMESTAMP);
  });
});

describe('QuestionsPanel under the contest provider', () => {
  it('renders the question instant in the contest wall clock', () => {
    render(<TimezoneProvider timezone={ROME}>{questionPanel()}</TimezoneProvider>);
    expect(screen.getByText(`From: ada at ${ROME_DATETIME}`)).toBeTruthy();
  });
});
