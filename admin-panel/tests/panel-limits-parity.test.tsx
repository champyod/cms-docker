// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { buildPayload, formFromContest } from '@/components/contests/contest-modal/contestFormMappers';
import type { ContestFormData, ExistingContest } from '@/components/contests/contest-modal/types';
import { LimitsTab as ContestLimitsTab } from '@/components/contests/contest-modal/tabs/LimitsTab';
import { TokensTab as ContestTokensTab } from '@/components/contests/contest-modal/tabs/TokensTab';
import { LimitsTab as TaskLimitsTab } from '@/components/tasks/task-modal-sections';
import { TokensTab as TaskTokensTab } from '@/components/tasks/task-modal-extra';
import type { TaskData } from '@/app/actions/tasks';
import en from '@/dictionaries/en.json';

afterEach(cleanup);

/** Every field the shared LimitField must own in the contest modal. */
const CONTEST_LIMIT_NAMES = [
  'max_submission_number',
  'max_user_test_number',
  'min_submission_interval',
  'min_user_test_interval',
  'per_user_time',
  'min_submission_interval_grace_period',
] as const;

/** The same family as the task modal names it. */
const TASK_LIMIT_NAMES = [
  'max_submission_number',
  'max_user_test_number',
  'min_submission_interval',
  'min_user_test_interval',
] as const;

function limitBox(name: string): HTMLInputElement {
  const box = document.querySelector(`[data-field="${name}"] input`);
  if (!(box instanceof HTMLInputElement)) throw new Error(`the ${name} limit box is missing`);
  return box;
}

function limitToggle(name: string): HTMLElement {
  const toggle = document.querySelector(`[data-field="${name}"] button[aria-pressed]`);
  if (!(toggle instanceof HTMLElement)) throw new Error(`the ${name} limit toggle is missing`);
  return toggle;
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

function ContestLimitsHarness({ initial }: { initial: ContestFormData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <ContestLimitsTab formData={formData} setFormData={setFormData} validationErrors={new Map()} />
    </DictionaryProvider>
  );
}

function ContestTokensHarness({ initial }: { initial: ContestFormData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <ContestTokensTab formData={formData} setFormData={setFormData} validationErrors={new Map()} />
    </DictionaryProvider>
  );
}

function TaskLimitsHarness({ initial }: { initial: TaskData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <TaskLimitsTab formData={formData} onChange={setFormData} />
    </DictionaryProvider>
  );
}

function TaskTokensHarness({ initial }: { initial: TaskData }) {
  const [formData, setFormData] = useState(initial);
  return (
    <DictionaryProvider dict={en}>
      <TaskTokensTab formData={formData} onChange={setFormData} />
    </DictionaryProvider>
  );
}

describe('the contest limits tab', () => {
  it('renders every limit, including the two that had no input at all, through LimitField', () => {
    render(<ContestLimitsHarness initial={formFromContest(existingContest({
      max_submission_number: null, max_user_test_number: null,
      min_submission_interval: null, min_user_test_interval: null,
      per_user_time: null, min_submission_interval_grace_period: null,
    }))} />);

    for (const name of CONTEST_LIMIT_NAMES) {
      expect(limitBox(name).value, name).toBe('');
      expect(limitToggle(name).getAttribute('aria-pressed'), name).toBe('true');
    }
  });

  it('shows a stored limit as a number with the toggle unpressed', () => {
    render(<ContestLimitsHarness initial={formFromContest(existingContest({
      per_user_time: '00:01:30', min_submission_interval_grace_period: 45,
    }))} />);

    expect(limitBox('per_user_time').value).toBe('90');
    expect(limitToggle('per_user_time').getAttribute('aria-pressed')).toBe('false');
    expect(limitBox('min_submission_interval_grace_period').value).toBe('45');
  });

  it('turns the two new fields into no limit when a 0 or a blank is typed', () => {
    render(<ContestLimitsHarness initial={formFromContest(existingContest({
      per_user_time: 90, min_submission_interval_grace_period: 45,
    }))} />);

    fireEvent.change(limitBox('per_user_time'), { target: { value: '0' } });
    fireEvent.change(limitBox('min_submission_interval_grace_period'), { target: { value: '' } });

    // The box is empty again because the form now holds null, not a 0 the API would refuse.
    expect(limitBox('per_user_time').value).toBe('');
    expect(limitToggle('per_user_time').getAttribute('aria-pressed')).toBe('true');
    expect(limitBox('min_submission_interval_grace_period').value).toBe('');
  });

  it('refuses a typed 0 on the older limits too', () => {
    render(<ContestLimitsHarness initial={formFromContest(existingContest({ max_submission_number: 100 }))} />);

    fireEvent.change(limitBox('max_submission_number'), { target: { value: '0' } });

    expect(limitBox('max_submission_number').value).toBe('');
    expect(limitToggle('max_submission_number').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the contest tokens tab', () => {
  it('renders both token caps through LimitField', () => {
    render(<ContestTokensHarness initial={formFromContest(existingContest({ token_mode: 'finite' }))} />);

    expect(limitBox('token_max_number').value).toBe('');
    expect(limitToggle('token_max_number').getAttribute('aria-pressed')).toBe('true');
    expect(limitBox('token_gen_max').value).toBe('');
    expect(limitToggle('token_gen_max').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the task limits tab', () => {
  const task = (patch: Partial<TaskData> = {}): TaskData => ({
    name: 'aplusb', title: 'A Plus B', score_mode: 'max', feedback_level: 'restricted',
    token_mode: 'disabled', token_max_number: null, token_min_interval: null,
    token_gen_initial: null, token_gen_number: null, token_gen_interval: null, token_gen_max: null,
    max_submission_number: null, max_user_test_number: null,
    min_submission_interval: null, min_user_test_interval: null,
    ...patch,
  });

  it('renders a null record as the unlimited state', () => {
    render(<TaskLimitsHarness initial={task()} />);

    for (const name of TASK_LIMIT_NAMES) {
      expect(limitBox(name).value, name).toBe('');
      expect(limitToggle(name).getAttribute('aria-pressed'), name).toBe('true');
    }
  });

  it('commits no limit for a typed 0 where the old box stored a 0', () => {
    render(<TaskLimitsHarness initial={task({ max_submission_number: 12 })} />);

    fireEvent.change(limitBox('max_submission_number'), { target: { value: '0' } });

    expect(limitBox('max_submission_number').value).toBe('');
  });
});

describe('the task tokens tab', () => {
  it('renders both token caps through LimitField', () => {
    render(<TaskTokensHarness initial={{
      name: 'aplusb', title: 'A Plus B', token_mode: 'finite',
      token_max_number: null, token_gen_max: null, token_min_interval: null,
      token_gen_initial: null, token_gen_number: null, token_gen_interval: null,
    }} />);

    expect(limitBox('token_max_number').value).toBe('');
    expect(limitBox('token_gen_max').value).toBe('');
    expect(limitToggle('token_gen_max').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the two contest fields that had no input', () => {
  it('keeps a null per-user time and grace period null through the form and the payload', () => {
    const form = formFromContest(existingContest({ per_user_time: null, min_submission_interval_grace_period: null }));

    expect(form.per_user_time).toBeNull();
    expect(form.min_submission_interval_grace_period).toBeNull();

    const payload = buildPayload(form);
    expect(payload.per_user_time).toBeNull();
    expect(payload.min_submission_interval_grace_period).toBeNull();
  });

  it('round-trips a stored 90 seconds as 90', () => {
    // Why the text form: a stored interval arrives as Postgres interval text, which is the shape
    // parseInterval exists to read.
    const form = formFromContest(existingContest({
      per_user_time: '00:01:30', min_submission_interval_grace_period: '00:01:30',
    }));

    expect(form.per_user_time).toBe(90);
    expect(form.min_submission_interval_grace_period).toBe(90);

    const payload = buildPayload(form);
    expect(payload.per_user_time).toBe(90);
    expect(payload.min_submission_interval_grace_period).toBe(90);
  });

  it('reads a stored zero interval as no limit rather than as a 0 in the box', () => {
    const form = formFromContest(existingContest({ per_user_time: '00:00:00' }));

    expect(form.per_user_time).toBeNull();
  });

  it('leaves a cleared interval out of the payload instead of sending the 0 the validator refuses', () => {
    const form = formFromContest(existingContest({ min_submission_interval: 60 }));

    const payload = buildPayload({ ...form, min_submission_interval: null, max_submission_number: 0 });

    expect(payload.min_submission_interval).not.toBe(0);
    expect(payload.max_submission_number).toBeNull();
  });
});
