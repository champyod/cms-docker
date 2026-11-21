import { describe, expect, it } from 'vitest';
import { buildPairs, type SourceItem } from '@/components/tasks/testcase-helpers';

function item(name: string): SourceItem {
  return { name, getBytes: async () => new Uint8Array([0]) };
}

describe('buildPairs', () => {
  it('pairs prefixed files under their full stem and tags the subtask', async () => {
    const pairs = await buildPairs([
      item('subtask1_01.in'),
      item('subtask1_01.out'),
      item('subtask1_02.in'),
      item('subtask1_02.out'),
      item('01.in'),
      item('01.out'),
    ], '*.in', '*.out');

    expect(pairs.map((pair) => pair.id)).toEqual(['01', 'subtask1_01', 'subtask1_02']);
    expect(pairs.find((pair) => pair.id === '01')?.subtask).toBeNull();
    expect(pairs.find((pair) => pair.id === 'subtask1_01')?.subtask).toBe('subtask1');
    expect(pairs.find((pair) => pair.id === 'subtask1_02')?.subtask).toBe('subtask1');
    expect(pairs.every((pair) => pair.status === 'ready')).toBe(true);
  });

  it('keeps plain numeric files working', async () => {
    const pairs = await buildPairs([item('01.in'), item('01.out')], '*.in', '*.out');
    expect(pairs.map((pair) => pair.id)).toEqual(['01']);
    expect(pairs[0].subtask).toBeNull();
  });

  it('leaves hyphen-separated groups detectable', async () => {
    const pairs = await buildPairs([
      item('st1-01.in'),
      item('st1-01.out'),
      item('st2-01.in'),
      item('st2-01.out'),
    ], '*.in', '*.out');
    expect(pairs.find((pair) => pair.id === 'st1-01')?.subtask).toBe('st1');
    expect(pairs.find((pair) => pair.id === 'st2-01')?.subtask).toBe('st2');
  });
});
