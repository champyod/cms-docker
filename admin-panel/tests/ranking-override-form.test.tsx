// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  saveRankingOverride: vi.fn(),
  searchRankingTargets: vi.fn(async () => []),
}));

vi.mock('@/app/actions/rankingOverrides', () => ({ saveRankingOverride: mocks.saveRankingOverride }));
vi.mock('@/app/actions/ranking', () => ({ searchRankingTargets: mocks.searchRankingTargets }));

import { RankingOverrideForm } from '@/components/ranking/RankingOverrideForm';
import en from '@/dictionaries/en.json';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(): HTMLElement {
  const { container } = render(
    <RankingOverrideForm
      copy={en.ranking.overrides}
      contestId="1"
      targetKind="user"
      targetKey=""
      userKeys={[{ key: 'ada', label: 'Ada Lovelace' }]}
      teamKeys={['alpha']}
      contestKeys={[{ key: 'Spring_20Contest', label: 'Spring Contest' }]}
      taskKeys={[{ key: 'Spring_20Contest/aplusb', label: 'Spring Contest / A Plus B' }]}
    />,
  );
  return container;
}

function optionValues(container: HTMLElement, group: string): string[] {
  return [...container.querySelectorAll<HTMLOptionElement>(`#${group} option`)].map(
    (option) => option.value,
  );
}

function selectKind(container: HTMLElement, kind: string): void {
  const select = container.querySelector<HTMLSelectElement>('#ranking-override-kind');
  if (select === null) throw new Error('the kind control is missing');
  fireEvent.change(select, { target: { value: kind } });
}

function selectAction(container: HTMLElement, action: string): void {
  const select = container.querySelector<HTMLSelectElement>('select[name="action"]');
  if (select === null) throw new Error('the action select is missing');
  fireEvent.change(select, { target: { value: action } });
}

function hiddenKey(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="hidden"][name="targetKey"]');
}

function valueField(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[name="value"]');
}

function openDropdown(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>('#ranking-override-target');
  if (input === null) throw new Error('the combobox is missing');
  fireEvent.focus(input);
}

function firstOption(container: HTMLElement): HTMLLIElement {
  const option = container.querySelector<HTMLLIElement>('#ranking-override-target-listbox li[role="option"]');
  if (option === null) throw new Error('the dropdown listed no option');
  return option;
}

describe('ranking override toolbar kinds', () => {
  it('offers only the three kinds the operator chooses between', () => {
    const container = renderForm();

    expect(optionValues(container, 'ranking-override-kind')).toEqual(['user', 'team', 'task']);
  });

  it('keeps contest and the whole board out of the kind menu', () => {
    const kinds = optionValues(renderForm(), 'ranking-override-kind');

    expect(kinds).not.toContain('contest');
    expect(kinds).not.toContain('ranking');
  });

  it('names the kind control from the dictionary, not a hand-written label', () => {
    const container = renderForm();

    const label = container.querySelector('label[for="ranking-override-kind"]');
    expect(label?.textContent).toContain(en.ranking.overrides.target);
  });
});

describe('ranking override toolbar target combobox', () => {
  it('carries the picked key in a hidden field so the typed text is never the value', () => {
    const container = renderForm();

    openDropdown(container);
    fireEvent.click(firstOption(container));

    expect(hiddenKey(container)?.value).toBe('ada');
  });

  it('shows the option label in the field rather than the key the row stores', () => {
    const container = renderForm();

    openDropdown(container);
    fireEvent.click(firstOption(container));

    const input = container.querySelector<HTMLInputElement>('#ranking-override-target');
    expect(input?.value).toBe('Ada Lovelace');
  });

  it('leaves the key blank while the operator is still typing', () => {
    const container = renderForm();

    const input = container.querySelector<HTMLInputElement>('#ranking-override-target');
    if (input === null) throw new Error('the combobox is missing');
    fireEvent.change(input, { target: { value: 'ada' } });

    expect(hiddenKey(container)?.value).toBe('');
  });

  it('resets the key when the kind changes, so a key cannot survive its own kind', () => {
    const container = renderForm();
    openDropdown(container);
    fireEvent.click(firstOption(container));

    selectKind(container, 'team');

    expect(hiddenKey(container)?.value).toBe('');
  });
});

describe('ranking override toolbar actions', () => {
  it('offers a task only the hide verb, because a task is a column and not a row', () => {
    const container = renderForm();

    selectKind(container, 'task');

    expect(optionValuesFromAction(container)).toEqual(['hide']);
    expect(valueField(container)).toBeNull();
  });

  it('names the task hide after what it drops, the column rather than a row', () => {
    const container = renderForm();

    selectKind(container, 'task');

    const hide = container.querySelector<HTMLOptionElement>('select[name="action"] option[value="hide"]');
    expect(hide?.textContent).toBe(en.ranking.overrides.actionHideTask);
  });

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

    expect(valueField(container)?.getAttribute('inputmode')).toBe('decimal');
  });

  it('places the submit button last, at the end of the action toolbar', () => {
    const container = renderForm();
    const form = container.querySelector('form');
    if (form === null) throw new Error('the toolbar form is missing');

    const submit = form.querySelector('button[type="submit"]');
    expect(submit).not.toBeNull();
    expect(form.lastElementChild?.contains(submit)).toBe(true);
  });
});

function optionValuesFromAction(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLOptionElement>('select[name="action"] option')].map(
    (option) => option.value,
  );
}
