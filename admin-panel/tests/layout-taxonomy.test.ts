import { describe, expect, it } from 'vitest';

import { PAGE_ARCHETYPES } from '@/components/patterns/page-types';
import { ARCHETYPE_COMPONENT, PAGE_ARCHETYPE_BY_ROUTE } from '@/components/patterns/registry';
import { PAGE_SLOTS } from '@/components/patterns/slots';

/**
 * The taxonomy is a promise about this product, so every kind must be a shape the product has.
 *
 * `form` was in the list with no page behind it: every create and edit here is a dialog that keeps
 * the list visible, so a page-level form had no consumer and no test against real data. It was
 * removed rather than kept as a template for a shape that does not exist.
 */
describe('layout taxonomy', () => {
  it('holds only kinds a page can actually declare', () => {
    expect([...PAGE_ARCHETYPES]).toEqual(['dashboard', 'list', 'detail', 'settings', 'board', 'modes', 'redirect']);
  });

  it('has no kind without a component and a slot contract', () => {
    for (const kind of PAGE_ARCHETYPES) {
      if (kind === 'redirect') {
        // A redirect renders nothing by definition; it is a route that forwards.
        expect(ARCHETYPE_COMPONENT[kind]).toBe('');
        continue;
      }
      expect(ARCHETYPE_COMPONENT[kind], `no component for ${kind}`).toBeTruthy();
      expect(PAGE_SLOTS[kind as Exclude<typeof kind, 'redirect'>], `no slots for ${kind}`).toBeTruthy();
    }
  });

  it('declares no route with a kind outside the taxonomy', () => {
    for (const [route, kind] of Object.entries(PAGE_ARCHETYPE_BY_ROUTE)) {
      expect(PAGE_ARCHETYPES, `${route} declares ${kind}`).toContain(kind);
    }
  });

  it('no longer offers a page-level form', () => {
    expect(PAGE_ARCHETYPES).not.toContain('form');
    expect(Object.values(ARCHETYPE_COMPONENT)).not.toContain('FormPage');
  });
});
