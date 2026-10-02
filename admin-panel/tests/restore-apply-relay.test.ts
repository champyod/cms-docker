import { describe, expect, it, vi } from 'vitest';

import { RELAY_CHUNK_SIZE, relayPageSql, relayTable } from '@/lib/restore-apply';
import type { RelayBatch, RelayOptions, RelayPage, RelayProgress, RelayRow, RelayRows, RelaySink, RelaySource } from '@/lib/restore-apply';

/** A page of `count` rows carrying a serial id from `from`, as the scratch container returns them. */
function serialPage(from: number, count: number): RelayRow[] {
  return Array.from({ length: count }, (_unused, offset) => ({ id: from + offset, name: `user ${from + offset}` }));
}

/** A source that answers with one canned page per call, and records every request. */
function recordingRelay(pages: readonly RelayRows[], options: Partial<RelayOptions> = {}) {
  const requests: RelayPage[] = [];
  const batches: RelayBatch[] = [];
  const source: RelaySource = (page) => {
    requests.push(page);
    return Promise.resolve(JSON.stringify(pages[requests.length - 1] ?? []));
  };
  const sink: RelaySink = (batch) => {
    batches.push(batch);
    return Promise.resolve();
  };
  return { result: relayTable(source, sink, { table: 'users', columns: ['id', 'name'], pkColumns: ['id'], ...options }), requests, batches };
}

/**
 * A source that pages a fixture for real, so a key the relay computes wrongly
 * surfaces as a rejected read instead of quietly restarting from the first row.
 */
function pagingSource(rows: readonly RelayRow[], pkColumns: readonly string[], failOnCall = 0) {
  const requests: RelayPage[] = [];
  const keyOf = (row: RelayRow): string => pkColumns.map((column) => String(row[column])).join('');
  const source: RelaySource = (page) => {
    requests.push(page);
    if (requests.length === failOnCall) return Promise.reject(new Error('scratch container went away'));
    const after = page.after;
    let start = 0;
    if (after !== null) {
      const index = rows.findIndex((row) => keyOf(row) === after.join(''));
      if (index < 0) return Promise.reject(new Error(`relay resumed after a key no row carries: ${after.join(', ')}`));
      start = index + 1;
    }
    return Promise.resolve(JSON.stringify(rows.slice(start, start + page.chunkSize)));
  };
  return { source, requests };
}

function failingSink(batches: RelayBatch[], failOnCall: number, reason: string): RelaySink {
  return (batch) => {
    batches.push(batch);
    return batches.length === failOnCall ? Promise.reject(new Error(reason)) : Promise.resolve();
  };
}

/** A source that never answers, so the chunk budget is what ends the read. */
function stalledSource(): RelaySource {
  const neverSettles = (): void => undefined;
  return () => new Promise<string>(neverSettles);
}

describe('relayPageSql', () => {
  it('reads the first page in key order with no resume predicate and no offset', () => {
    expect(relayPageSql('users', ['id', 'name'], ['id'], 5000, null)).toBe(
      'SELECT coalesce(json_agg(row_to_json(s))::text, \'[]\') FROM ' +
        '(SELECT "id", "name" FROM "public"."users" ORDER BY "id" LIMIT 5000) AS s',
    );
  });

  it('resumes after the last key with a row-wise comparison for a composite key', () => {
    expect(relayPageSql('submission_results', ['submission_id', 'dataset_id'], ['submission_id', 'dataset_id'], 10, ['3', '7'])).toBe(
      'SELECT coalesce(json_agg(row_to_json(s))::text, \'[]\') FROM ' +
        '(SELECT "submission_id", "dataset_id" FROM "public"."submission_results" ' +
        'WHERE ("submission_id", "dataset_id") > (\'3\', \'7\') ORDER BY "submission_id", "dataset_id" LIMIT 10) AS s',
    );
  });

  it('quotes a text key value so a quote inside it cannot close the literal', () => {
    const sql = relayPageSql('fsobjects', ['digest'], ['digest'], 5, ["a'b"]);
    expect(sql).toContain('WHERE ("digest") > (\'a\'\'b\')');
    expect(sql).toContain('ORDER BY "digest" LIMIT 5');
  });

  it('refuses a page it cannot page with', () => {
    expect(() => relayPageSql('users', ['id'], [], 5, null)).toThrow(/primary key/);
    expect(() => relayPageSql('users', [], ['id'], 5, null)).toThrow(/no columns/);
    expect(() => relayPageSql('users', ['id'], ['id'], 0, null)).toThrow(/row\(s\)/);
    expect(() => relayPageSql('users', ['id'], ['id'], 5, ['1', '2'])).toThrow(/key part/);
  });
});

describe('relayTable', () => {
  it('relays an empty table without asking the sink to write anything', async () => {
    const { result, requests, batches } = recordingRelay([]);
    expect(await result).toEqual({ rowsMoved: 0, chunksDone: 0 });
    expect(requests).toHaveLength(1);
    expect(batches).toHaveLength(0);
  });

  it('stops on a short page instead of reading the table a second time', async () => {
    const { result, requests, batches } = recordingRelay([serialPage(1, 5), serialPage(6, 2)], { chunkSize: 5 });
    expect(await result).toEqual({ rowsMoved: 7, chunksDone: 2 });
    expect(requests.map((page) => page.after)).toEqual([null, ['5']]);
    expect(batches.map((batch) => batch.rows)).toEqual([5, 2]);
  });

  it('reads one more page when the last page it wrote was exactly full', async () => {
    const { result, requests, batches } = recordingRelay([serialPage(1, 5), serialPage(6, 5), []], { chunkSize: 5 });
    expect(await result).toEqual({ rowsMoved: 10, chunksDone: 2 });
    expect(requests).toHaveLength(3);
    expect(batches).toHaveLength(2);
  });

  it('hands the sink one JSON document per chunk, carrying that chunk\'s rows only', async () => {
    const { result, batches } = recordingRelay([serialPage(1, 2)], { chunkSize: 2 });
    expect(await result).toEqual({ rowsMoved: 2, chunksDone: 1 });
    expect(JSON.parse(batches[0].payload)).toEqual(serialPage(1, 2));
  });

  it('pages every row of a table exactly once, in key order, on a composite key', async () => {
    const rows: RelayRow[] = Array.from({ length: 23 }, (_unused, index) => ({ submission_id: Math.floor(index / 3) + 1, dataset_id: (index % 3) + 1 }));
    const { source } = pagingSource(rows, ['submission_id', 'dataset_id']);
    const batches: RelayBatch[] = [];
    const seen: RelayProgress[] = [];
    const result = await relayTable(source, (batch) => { batches.push(batch); return Promise.resolve(); }, {
      table: 'submission_results',
      columns: ['submission_id', 'dataset_id'],
      pkColumns: ['submission_id', 'dataset_id'],
      chunkSize: 5,
      onProgress: (moved) => seen.push(moved),
    });
    expect(result).toEqual({ rowsMoved: 23, chunksDone: 5 });
    expect(seen.at(-1)).toEqual({ rowsMoved: 23, chunksDone: 5 });
    expect(batches.flatMap((batch) => JSON.parse(batch.payload))).toEqual(rows);
  });

  it('reports rows moved and chunks done as each chunk is written', async () => {
    const seen: RelayProgress[] = [];
    const { result } = recordingRelay([serialPage(1, 2), serialPage(3, 2)], { chunkSize: 2, onProgress: (moved) => seen.push(moved) });
    await result;
    expect(seen).toEqual([{ rowsMoved: 2, chunksDone: 1 }, { rowsMoved: 4, chunksDone: 2 }]);
  });

  it('pages 5000 rows at a time by default and hands the caller the chunk budget', async () => {
    expect(RELAY_CHUNK_SIZE).toBe(5000);
    const { result, requests } = recordingRelay([[]]);
    await result;
    expect(requests[0].chunkSize).toBe(RELAY_CHUNK_SIZE);
    expect(requests[0].timeoutMs).toBe(120_000);
  });

  it('stops with the source failure and leaves the chunks it already wrote', async () => {
    const rows = Array.from({ length: 12 }, (_unused, index) => ({ id: index + 1, name: 'x' }));
    const { source, requests } = pagingSource(rows, ['id'], 2);
    const batches: RelayBatch[] = [];
    const result = relayTable(source, (batch) => { batches.push(batch); return Promise.resolve(); }, { table: 'users', columns: ['id', 'name'], pkColumns: ['id'], chunkSize: 5 });
    await expect(result).rejects.toThrow('scratch container went away');
    expect(requests).toHaveLength(2);
    expect(batches).toHaveLength(1);
  });

  it('stops with the sink failure rather than reporting the rows as moved', async () => {
    const batches: RelayBatch[] = [];
    const seen: RelayProgress[] = [];
    const source: RelaySource = () => Promise.resolve(JSON.stringify(serialPage(1, 5)));
    const result = relayTable(source, failingSink(batches, 2, 'staging insert was cancelled'), {
      table: 'users',
      columns: ['id', 'name'],
      pkColumns: ['id'],
      chunkSize: 5,
      onProgress: (moved) => seen.push(moved),
    });
    await expect(result).rejects.toThrow('staging insert was cancelled');
    expect(batches).toHaveLength(2);
    expect(seen).toEqual([{ rowsMoved: 5, chunksDone: 1 }]);
  });

  it('stops a chunk that outlives its budget instead of hanging on it', async () => {
    vi.useFakeTimers();
    try {
      const result = relayTable(stalledSource(), () => Promise.resolve(), { table: 'users', columns: ['id'], pkColumns: ['id'], chunkTimeoutMs: 1000 });
      const rejection = expect(result).rejects.toThrow('"users" chunk 1 did not finish within 1000 ms');
      await vi.advanceTimersByTimeAsync(1000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to relay a table it cannot page, or a chunk that is not rows', async () => {
    const options: RelayOptions = { table: 'users', columns: ['id'], pkColumns: ['id'] };
    await expect(relayTable(() => Promise.resolve('[]'), () => Promise.resolve(), { ...options, pkColumns: [] })).rejects.toThrow(/primary key/);
    await expect(relayTable(() => Promise.resolve('[]'), () => Promise.resolve(), { ...options, chunkSize: 1.5 })).rejects.toThrow(/positive whole number/);
    await expect(relayTable(() => Promise.resolve('{"id":1}'), () => Promise.resolve(), options)).rejects.toThrow(/not a JSON array/);
  });

  it('refuses a chunk whose last row carries no scalar key', async () => {
    const result = relayTable(() => Promise.resolve('[{"name":"x"}]'), () => Promise.resolve(), { table: 'users', columns: ['id', 'name'], pkColumns: ['id'], chunkSize: 1 });
    await expect(result).rejects.toThrow('"users" carries a row whose "id" is missing');
  });
});
