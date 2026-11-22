import type { PageArchetype } from '@/components/patterns/page-types';

/**
 * What a page of each kind must tell the reader, in the order it is read.
 *
 * A page supplies these facts and nothing else: no page invents a section, and no fact lives on
 * two pages. The list is deliberately short - a fact that does not change what the operator does
 * is noise, and every fact here has a place it is rendered by the layout rather than by the page.
 */
export interface PageSlot {
  /** Stable key the inventory refers to. */
  readonly key: string;
  /** What the fact answers, phrased as the question an operator would ask. */
  readonly asks: string;
  /** False when a page of this kind may legitimately leave it out. */
  readonly required: boolean;
}

const STATE: PageSlot = { key: 'state', asks: 'Is anything wrong right now?', required: true };
const FRESHNESS: PageSlot = { key: 'freshness', asks: 'How old is what I am looking at?', required: true };

export const PAGE_SLOTS: Readonly<Record<Exclude<PageArchetype, 'redirect'>, readonly PageSlot[]>> = {
  dashboard: [
    STATE,
    FRESHNESS,
    { key: 'totals', asks: 'How much is there, per area?', required: true },
    { key: 'activity', asks: 'What happened most recently?', required: true },
    { key: 'action', asks: 'What is the one thing to do about the state?', required: false },
  ],
  list: [
    STATE,
    FRESHNESS,
    { key: 'rows', asks: 'Which records are there, and in what order?', required: true },
    { key: 'count', asks: 'How many in total, against how many shown?', required: true },
    { key: 'filter', asks: 'How do I narrow this?', required: true },
    { key: 'rowActions', asks: 'What can I do to one row?', required: true },
    { key: 'bulkActions', asks: 'What can I do to several?', required: false },
    { key: 'create', asks: 'How do I add one?', required: false },
    { key: 'empty', asks: 'What does empty mean here?', required: true },
  ],
  detail: [
    STATE,
    FRESHNESS,
    { key: 'identity', asks: 'Which record is this?', required: true },
    { key: 'facts', asks: 'What are its values?', required: true },
    { key: 'related', asks: 'What else belongs to it?', required: false },
    { key: 'actions', asks: 'What can I do to it?', required: true },
    { key: 'history', asks: 'What changed, and who changed it?', required: false },
  ],
  form: [
    STATE,
    { key: 'fields', asks: 'What do I have to supply?', required: true },
    { key: 'validation', asks: 'What is wrong with what I typed, and where?', required: true },
    { key: 'submit', asks: 'What happens when I press this?', required: true },
    { key: 'cancel', asks: 'How do I leave without saving?', required: true },
  ],
  settings: [
    STATE,
    { key: 'groups', asks: 'Which settings belong together?', required: true },
    { key: 'scope', asks: 'Does this change my screen, or everyone’s?', required: true },
    { key: 'save', asks: 'What have I changed and is it saved?', required: true },
    { key: 'reset', asks: 'How do I get back to the default?', required: false },
  ],
};

/**
 * Redirects carry no surface: they forward an old address to its canonical route. They still
 * declare, because a route that silently renders a page again is how two addresses start to
 * disagree about the same content.
 */
export const REDIRECT_SLOTS: readonly PageSlot[] = [];
