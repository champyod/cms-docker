// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { buildPayload, formFromContest } from '@/components/contests/contest-modal/contestFormMappers';
import type { ContestFormData, ExistingContest } from '@/components/contests/contest-modal/types';
import { LimitsTab as ContestLimitsTab } from '@/components/contests/contest-modal/tabs/LimitsTab';
import { LimitsTab as TaskLimitsTab } from '@/components/tasks/task-modal-sections';
import { interpolate } from '@/lib/interpolate';
import type { TaskData } from '@/app/actions/tasks';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

afterEach(cleanup);

const RESERVED = ['evaluation_throttle_window_s', 'evaluation_throttle_max', 'evaluation_final_open', 'evaluation_final_open_at'] as const;

function box(name: string): HTMLInputElement {
  const element = document.querySelector(`[data-field="${name}"] input`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`the ${name} field is missing`);
  return element;
}

function fieldText(name: string): string {
  const element = document.querySelector(`[data-field="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`the ${name} field is missing`);
  return element.textContent ?? '';
}

function existingContest(patch: Partial<ExistingContest> = {}): ExistingContest {
  const base: ExistingContest = {
    id: 7, name: 'Seven', description: 'Description',
    start: '2026-12-31T08:00:00.000Z', stop: '2026-12-31T13:00:00.000Z',
    timezone: 'Asia/Bangkok', allowed_localizations: [], languages: ['cpp'],
    submissions_download_allowed: true, allow_questions: true, allow_user_tests: false,
    allow_unofficial_submission_before_analysis_mode: false, block_hidden_participations: false,
    allow_password_authentication: true, allow_registration: false, ip_restriction: false,
    ip_autologin: false, token_mode: 'disabled', token_max_number: null, token_min_interval: 60,
    token_gen_number: 0, token_gen_initial: 0, token_gen_interval: 30, token_gen_max: null,
    max_submission_number: 100, max_user_test_number: null, min_submission_interval: 60,
    min_user_test_interval: 60, per_user_time: null, min_submission_interval_grace_period: null,
    queue_fairness_penalty_seconds: 0, score_precision: 2, analysis_enabled: true,
    analysis_start: '2026-12-31T14:00:00.000Z', analysis_stop: '2026-12-31T15:00:00.000Z',
  };
  return Object.assign(base, patch);
}

function ContestHarness({ initial }: { initial: ContestFormData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <ContestLimitsTab formData={formData} setFormData={setFormData} validationErrors={new Map()} />
    </DictionaryProvider>
  );
}

function TaskHarness({ initial }: { initial: TaskData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <TaskLimitsTab formData={formData} onChange={setFormData} />
    </DictionaryProvider>
  );
}

function taskData(patch: Partial<TaskData> = {}): TaskData {
  return {
    name: 'aplusb', title: 'A Plus B', score_mode: 'max', feedback_level: 'restricted',
    token_mode: 'disabled', token_max_number: null, token_min_interval: null,
    token_gen_initial: null, token_gen_number: null, token_gen_interval: null, token_gen_max: null,
    max_submission_number: null, max_user_test_number: null,
    min_submission_interval: null, min_user_test_interval: null,
    ...patch,
  };
}

describe('the contest throttle family surface', () => {
  it('renders the delay as an editable non-negative whole number', () => {
    render(<ContestHarness initial={formFromContest(existingContest({ evaluation_throttle_delay_s: 30 }))} />);

    const delay = box('evaluation_throttle_delay_s');
    expect(delay.type).toBe('number');
    expect(delay.disabled).toBe(false);
    expect(delay.min).toBe('0');
    expect(delay.value).toBe('30');

    fireEvent.change(delay, { target: { value: '45' } });
    expect(box('evaluation_throttle_delay_s').value).toBe('45');
  });

  it('keeps a 0 as a 0 in the box, and reads a blank as the column own 0 rather than an infinity', () => {
    render(<ContestHarness initial={formFromContest(existingContest({ evaluation_throttle_delay_s: 0 }))} />);

    // 0 is a real value here ("no throttle delay of my own"), not the "no limit" state of the limit boxes.
    expect(box('evaluation_throttle_delay_s').value).toBe('0');

    fireEvent.change(box('evaluation_throttle_delay_s'), { target: { value: '' } });
    expect(box('evaluation_throttle_delay_s').value).toBe('0');
  });

  it('names the resolution order the classic uses, including the legacy penalty the field sits above', () => {
    render(<ContestHarness initial={formFromContest(existingContest())} />);

    const text = fieldText('evaluation_throttle_delay_s');
    expect(text).toContain(en.limits.throttle.delayHint);
    expect(en.limits.throttle.delayHint).toContain('Queue Fairness Penalty');
    expect(en.limits.throttle.delayHint).toContain("task's override");
  });

  it('renders the three inert columns and the timestamp disabled, each labelled as reserved', () => {
    render(<ContestHarness initial={formFromContest(existingContest({
      evaluation_throttle_window_s: 45, evaluation_throttle_max: 3,
      evaluation_final_open: true, evaluation_final_open_at: '2026-12-31T15:00:00.000Z',
    }))} />);

    for (const name of RESERVED) {
      const input = box(name);
      expect(input.disabled, name).toBe(true);
      expect(fieldText(name), name).toContain(en.limits.throttle.reserved);
      expect(input.getAttribute('aria-describedby'), name).toBe(`${name}-reserved`);
    }
    // The operator can read the stored schema, but the control writes nothing.
    expect((box('evaluation_throttle_window_s') as HTMLInputElement).value).toBe('45');
    expect((box('evaluation_final_open') as HTMLInputElement).checked).toBe(true);
  });

  it('drops the four reserved columns from the payload and keeps the delay, 0 included', () => {
    const form = formFromContest(existingContest({
      evaluation_throttle_delay_s: 0, evaluation_throttle_window_s: 45,
      evaluation_throttle_max: 3, evaluation_final_open: true,
    }));

    const payload = buildPayload(form) as unknown as Record<string, unknown>;
    for (const name of RESERVED) expect(payload[name], name).toBeUndefined();
    expect(payload.evaluation_throttle_delay_s).toBe(0);
  });

  it('sends a positive delay the operator typed', () => {
    const form = formFromContest(existingContest({ evaluation_throttle_delay_s: 30 }));
    expect(buildPayload({ ...form, evaluation_throttle_delay_s: 90 }).evaluation_throttle_delay_s).toBe(90);
  });
});

describe('the task throttle override control', () => {
  it('shows a blank box as the inherit state and says so', () => {
    render(<TaskHarness initial={taskData()} />);

    const override = box('evaluation_throttle_delay_s');
    expect(override.type).toBe('number');
    expect(override.disabled).toBe(false);
    expect(override.value).toBe('');
    expect(override.placeholder).toBe(en.limits.throttle.overridePlaceholder);
    expect(fieldText('evaluation_throttle_delay_s')).toContain(en.limits.throttle.overrideInherit);
    expect(fieldText('evaluation_throttle_delay_s')).toContain(en.limits.throttle.overrideHint);
  });

  it('names the "no delay for this task" state when a 0 is typed', () => {
    render(<TaskHarness initial={taskData({ evaluation_throttle_delay_s: 4 })} />);

    fireEvent.change(box('evaluation_throttle_delay_s'), { target: { value: '0' } });

    expect(box('evaluation_throttle_delay_s').value).toBe('0');
    expect(fieldText('evaluation_throttle_delay_s')).toContain(en.limits.throttle.overrideNone);
  });

  it('names the "N seconds for this task only" state when N is typed', () => {
    render(<TaskHarness initial={taskData()} />);

    fireEvent.change(box('evaluation_throttle_delay_s'), { target: { value: '12' } });

    expect(box('evaluation_throttle_delay_s').value).toBe('12');
    expect(fieldText('evaluation_throttle_delay_s')).toContain(interpolate(en.limits.throttle.overrideSeconds, { seconds: 12 }));
  });

  it('returns to the inherit state when the box is cleared again', () => {
    render(<TaskHarness initial={taskData({ evaluation_throttle_delay_s: 12 })} />);
    expect(fieldText('evaluation_throttle_delay_s')).toContain(interpolate(en.limits.throttle.overrideSeconds, { seconds: 12 }));

    fireEvent.change(box('evaluation_throttle_delay_s'), { target: { value: '' } });

    expect(box('evaluation_throttle_delay_s').value).toBe('');
    expect(fieldText('evaluation_throttle_delay_s')).toContain(en.limits.throttle.overrideInherit);
  });
});

describe('the throttle copy in both dictionaries', () => {
  it('carries every English string in Thai as well, additions only', () => {
    expect(Object.keys(th.limits.throttle).sort()).toEqual(Object.keys(en.limits.throttle).sort());
    for (const [key, value] of Object.entries(en.limits.throttle)) {
      expect(typeof value, key).toBe('string');
      const translated = (th.limits.throttle as Record<string, string>)[key];
      expect(translated, key).toBeTruthy();
      expect(translated, key).not.toBe(value);
    }
  });

  it('gives the reserved wording exactly one reading in each language', () => {
    expect(en.limits.throttle.reserved).toBe('Reserved — nothing reads it yet');
    expect(th.limits.throttle.reserved).toBe('สำรองไว้ — ยังไม่มีส่วนใดอ่านค่านี้');
  });
});
