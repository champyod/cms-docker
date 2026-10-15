// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('@/app/actions/rankingOverrides', () => ({ saveRankingOverride: vi.fn() }));

import { RankingOverrideForm } from '@/components/ranking/RankingOverrideForm';
import en from '@/dictionaries/en.json';

afterEach(() => cleanup());

function renderForm(): HTMLElement {
  const { container } = render(
    <RankingOverrideForm
      copy={en.ranking.overrides}
      contests={[{ id: 1, name: 'Spring Contest' }]}
      userKeys={[{ key: 'ada', label: 'Ada Lovelace' }]}
      teamKeys={['alpha']}
      contestKeys={[{ key: 'Spring_20Contest', label: 'Spring Contest' }]}
      taskKeys={[{ key: 'Spring_20Contest/aplusb', label: 'Spring Contest / A Plus B' }]}
      contestId="1"
      targetKind="user"
      targetKey=""
    />,
  );
  return container;
}

function selectAction(container: HTMLElement, action: string): void {
  const select = container.querySelector<HTMLSelectElement>('select[name="action"]');
  if (select === null) throw new Error('the action select is missing');
  fireEvent.change(select, { target: { value: action } });
}

function selectKind(container: HTMLElement, kind: string): void {
  const select = container.querySelector<HTMLSelectElement>('select[name="targetKind"]');
  if (select === null) throw new Error('the target select is missing');
  fireEvent.change(select, { target: { value: kind } });
}

function optionValues(container: HTMLElement, name: string): string[] {
  const options = container.querySelectorAll<HTMLOptionElement>(`select[name="${name}"] option`);
  return [...options].map((option) => option.value);
}

function valueField(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[name="value"]');
}

describe('ranking override form value controls', () => {
  it('carries no value field for hide, which needs none', () => {
    expect(valueField(renderForm())).toBeNull();
  });

  it('carries the cutoff field for freeze, which the board replays up to', () => {
    const container = renderForm();
    selectAction(container, 'freeze');
    const field = valueField(container);
    expect(field?.type).toBe('number');
    expect(field?.getAttribute('inputmode')).toBe('numeric');
  });

  it('keeps the decimal field the score verb already had', () => {
    const container = renderForm();
    selectAction(container, 'score');
    const field = valueField(container);
    expect(field?.type).toBe('number');
    expect(field?.getAttribute('inputmode')).toBe('decimal');
  });
});

describe('ranking override form task target', () => {
  it('offers a task only the hide verb, because a task is a column and not a row', () => {
    const container = renderForm();

    selectKind(container, 'task');

    expect(optionValues(container, 'action')).toEqual(['hide']);
    expect(valueField(container)).toBeNull();
  });

  it('names the task hide after what it drops, the column rather than a row', () => {
    const container = renderForm();

    selectKind(container, 'task');

    const hide = container.querySelector<HTMLOptionElement>('select[name="action"] option[value="hide"]');
    expect(hide?.textContent).toBe(en.ranking.overrides.actionHideTask);
  });

  it('lists the composite task keys the board keys its columns by', () => {
    const container = renderForm();

    selectKind(container, 'task');

    expect(optionValues(container, 'targetKey')).toEqual(['', 'Spring_20Contest/aplusb']);
  });

  it('resets a verb the new target cannot mean, so a task never carries a score override', () => {
    const container = renderForm();

    selectAction(container, 'score');
    selectKind(container, 'task');

    expect(optionValues(container, 'action')).toEqual(['hide']);
    expect(valueField(container)).toBeNull();
  });
});

describe('ranking override form contest target', () => {
  it('offers the contest option and a contest only the hide verb', () => {
    const container = renderForm();

    expect(optionValues(container, 'targetKind')).toContain('contest');

    selectKind(container, 'contest');

    expect(optionValues(container, 'action')).toEqual(['hide']);
    expect(valueField(container)).toBeNull();
  });

  it('names the contest hide after what it drops, the contest and its tasks', () => {
    const container = renderForm();

    selectKind(container, 'contest');

    const hide = container.querySelector<HTMLOptionElement>('select[name="action"] option[value="hide"]');
    expect(hide?.textContent).toBe(en.ranking.overrides.actionHideContest);
  });

  it('lists the encoded contest keys the board keys the group by', () => {
    const container = renderForm();

    selectKind(container, 'contest');

    expect(optionValues(container, 'targetKey')).toEqual(['', 'Spring_20Contest']);
  });

  it('resets a verb the new target cannot mean, so a contest never carries a freeze override', () => {
    const container = renderForm();

    selectAction(container, 'freeze');
    selectKind(container, 'contest');

    expect(optionValues(container, 'action')).toEqual(['hide']);
    expect(valueField(container)).toBeNull();
  });
});
