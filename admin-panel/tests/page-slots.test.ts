import { describe, expect, it } from 'vitest';

import { PAGE_SLOTS } from '@/components/patterns/slots';

/**
 * The slot contract is what makes a page's facts reviewable, so the requirement level of each slot
 * is a decision worth pinning: loosening one silently lets a page ship without the fact, tightening
 * one pushes a page to invent content.
 */
describe('page slot contract', () => {
  const required = (kind: keyof typeof PAGE_SLOTS) =>
    PAGE_SLOTS[kind].filter((slot) => slot.required).map((slot) => slot.key);

  it('requires a dashboard to lead with state, freshness and totals', () => {
    expect(required('dashboard')).toEqual(['state', 'freshness', 'totals']);
  });

  it('leaves the activity feed to the page, because not every dashboard has one', () => {
    const activity = PAGE_SLOTS.dashboard.find((slot) => slot.key === 'activity');
    expect(activity?.required).toBe(false);
  });

  it('requires a board to say what each section means when empty', () => {
    expect(required('board')).toContain('sections');
    expect(PAGE_SLOTS.board.some((slot) => slot.asks.includes('when empty'))).toBe(true);
  });

  it('requires a list to state its total and its empty meaning', () => {
    expect(required('list')).toEqual(
      expect.arrayContaining(['rows', 'count', 'filter', 'rowActions', 'empty'])
    );
  });
});
