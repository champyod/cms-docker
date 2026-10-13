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

function valueField(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[name="value"]');
}

describe('ranking override form value controls', () => {
  it('carries no value field for hide, which needs none', () => {
    expect(valueField(renderForm())).toBeNull();
  });

  it('carries no value field for freeze, which the board reads as a flag', () => {
    const container = renderForm();
    selectAction(container, 'freeze');
    expect(valueField(container)).toBeNull();
  });

  it('keeps the decimal field the score verb already had', () => {
    const container = renderForm();
    selectAction(container, 'score');
    const field = valueField(container);
    expect(field?.type).toBe('number');
    expect(field?.getAttribute('inputmode')).toBe('decimal');
  });
});
