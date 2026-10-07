import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  MAX_CASCADE_DEPTH,
  UNIQUE_CHECK_ROW_LIMIT,
  accountUsernameConflictId,
  accountUsernameConflictMessage,
  buildRestoreStrategies,
  conflictMessage,
  detectUniqueConflicts,
  displayKey,
  displayValues,
  fkOverwriteConflictMessage,
  isPrivilegeOwnedIndex,
  parseFkEdges,
  parseUniqueIndexes,
  parseUniqueValueRows,
  planKeyRenameCascade,
  scratchDeleteRowSql,
  scratchRewriteBatchSql,
  scratchUpdateKeySql,
  scratchUpdateValueSql,
  uniqueCheckWasTruncated,
  uniqueConflictId,
  uniqueIndexNeedsCheck,
  uniqueValueConflictMessage,
} from '@/lib/restore-apply';
import type {
  AccountUsernameConflict,
  FkEdge,
  FkOverwriteConflict,
  UniqueIndex,
  UniqueIndexRow,
  UniqueValueRow,
} from '@/lib/restore-apply';

const ADMINS_USERNAME_INDEX: UniqueIndex = {
  table: 'admins',
  name: 'admins_username_key',
  columns: ['username'],
};

const TOKENS_OPAQUE_INDEX: UniqueIndex = {
  table: 'tokens',
  name: 'participation_opaque_unique',
  columns: ['participation_id', 'opaque_id'],
};

const FILES_NAME_INDEX: UniqueIndex = {
  table: 'files',
  name: 'files_submission_id_filename_key',
  columns: ['submission_id', 'filename'],
};

function indexRow(definition: string, name = 'some_key', table = 'contests'): UniqueIndexRow {
  return { table, name, definition };
}

function valueRow(values: readonly string[], key: readonly string[]): UniqueValueRow {
  return { values, key };
}

describe('parseUniqueIndexes', () => {
  it('reads the table and columns out of a single-column unique index', () => {
    const parsed = parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "admins_username_key" ON public.admins USING btree (username)', 'admins_username_key', 'admins')]);
    expect(parsed).toEqual([ADMINS_USERNAME_INDEX]);
  });

  it('reads every column of a composite unique index and keeps the explicit index name', () => {
    const parsed = parseUniqueIndexes([
      indexRow('CREATE UNIQUE INDEX "participation_opaque_unique" ON public.tokens USING btree (participation_id, opaque_id)', 'participation_opaque_unique', 'tokens'),
    ]);
    expect(parsed).toEqual([TOKENS_OPAQUE_INDEX]);
  });

  it('unquotes an identifier postgres had to quote', () => {
    const parsed = parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "tasks_contest_id_name_key" ON public.tasks USING btree (contest_id, "name")')]);
    expect(parsed[0]?.columns).toEqual(['contest_id', 'name']);
  });

  it('refuses a partial unique index, whose predicate it cannot decide', () => {
    expect(parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "x" ON public.contests USING btree (code) WHERE (deleted = false)')])).toEqual([]);
  });

  it('refuses an expression index, which keys on a value no column holds', () => {
    expect(parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "y" ON public.contests USING btree (lower(name))')])).toEqual([]);
  });

  it('refuses a non-unique index', () => {
    expect(parseUniqueIndexes([indexRow('CREATE INDEX "z" ON public.contests USING btree (id)')])).toEqual([]);
  });

  it('refuses a definition it cannot locate a column list in, rather than reading the wrong one', () => {
    expect(parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "w" ON public.contests')])).toEqual([]);
  });

  it('keeps the trailing index options out of the column list', () => {
    const parsed = parseUniqueIndexes([indexRow('CREATE UNIQUE INDEX "n" ON public.contests USING btree (code) NULLS NOT DISTINCT')]);
    expect(parsed[0]?.columns).toEqual(['code']);
  });

  it('keeps the indexes it can read beside the ones it drops', () => {
    const parsed = parseUniqueIndexes([
      indexRow('CREATE INDEX "b" ON public.contests USING btree (id)', 'b'),
      indexRow('CREATE UNIQUE INDEX "a" ON public.contests USING btree (name)', 'a'),
    ]);
    expect(parsed.map((index) => index.name)).toEqual(['a']);
  });
});

describe('uniqueIndexNeedsCheck', () => {
  it('skips an index whose columns already contain the whole primary key', () => {
    const index: UniqueIndex = { table: 'statements', name: 'statements_id_task_id_key', columns: ['id', 'task_id'] };
    expect(uniqueIndexNeedsCheck(index, ['id'])).toBe(false);
    expect(uniqueIndexNeedsCheck(index, ['id', 'task_id'])).toBe(false);
  });

  it('checks an index that constrains something the primary key does not', () => {
    expect(uniqueIndexNeedsCheck(ADMINS_USERNAME_INDEX, ['id'])).toBe(true);
    expect(uniqueIndexNeedsCheck(FILES_NAME_INDEX, ['id'])).toBe(true);
  });

  it('checks nothing for a table with no catalog primary key', () => {
    expect(uniqueIndexNeedsCheck(ADMINS_USERNAME_INDEX, [])).toBe(false);
  });
});

describe('detectUniqueConflicts', () => {
  it('reports a value both sides hold under different primary keys', () => {
    const conflicts = detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['ada'], ['7'])], [valueRow(['ada'], ['1'])]);
    expect(conflicts).toEqual([
      {
        id: uniqueConflictId(ADMINS_USERNAME_INDEX, ['ada']),
        kind: 'unique-value',
        table: 'admins',
        index: 'admins_username_key',
        columns: ['username'],
        values: ['ada'],
        stagedKey: ['7'],
        liveKey: ['1'],
      },
    ]);
  });

  it('leaves a value both sides hold under the same primary key alone, because the upsert updates that row', () => {
    expect(detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['ada'], ['1'])], [valueRow(['ada'], ['1'])])).toEqual([]);
    expect(detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['ada'], ['1', 'x'])], [valueRow(['ada'], ['1', 'x'])])).toEqual([]);
  });

  it('reports nothing for an archive value live does not hold, or a live value the archive lacks', () => {
    expect(detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['grace'], ['9'])], [valueRow(['ada'], ['1'])])).toEqual([]);
    expect(detectUniqueConflicts(ADMINS_USERNAME_INDEX, [], [valueRow(['ada'], ['1'])])).toEqual([]);
  });

  it('tells a composite value apart on every column, not on joined text', () => {
    const staged = [valueRow(['4', 'a|b.ts'], ['88'])];
    const live = [valueRow(['4|a', 'b.ts'], ['31'])];
    expect(detectUniqueConflicts(FILES_NAME_INDEX, staged, live)).toEqual([]);
  });

  it('still reports a composite conflict when the whole tuple matches and the keys differ', () => {
    const conflicts = detectUniqueConflicts(FILES_NAME_INDEX, [valueRow(['4', 'a|b.ts'], ['88'])], [valueRow(['4', 'a|b.ts'], ['31'])]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.columns).toEqual(['submission_id', 'filename']);
    expect(conflicts[0]?.values).toEqual(['4', 'a|b.ts']);
  });

  it('reports every conflicting value, sorted, so the prompt order is stable', () => {
    const staged = [valueRow(['zoe'], ['3']), valueRow(['ada'], ['7'])];
    const live = [valueRow(['zoe'], ['30']), valueRow(['ada'], ['1'])];
    expect(detectUniqueConflicts(ADMINS_USERNAME_INDEX, staged, live).map((conflict) => conflict.values)).toEqual([['ada'], ['zoe']]);
  });

  it('names the index in the id, so two indexes on one table cannot collide', () => {
    const other: UniqueIndex = { table: 'admins', name: 'admins_other_key', columns: ['username'] };
    expect(uniqueConflictId(ADMINS_USERNAME_INDEX, ['ada'])).not.toBe(uniqueConflictId(other, ['ada']));
    expect(uniqueConflictId(TOKENS_OPAQUE_INDEX, ['4', 'opq-1'])).toContain('tokens');
  });
});

describe('display helpers', () => {
  it('renders a value tuple as one line, marking an empty string', () => {
    expect(displayValues(['ada'])).toBe('ada');
    expect(displayValues(['4', 'a|b.ts'])).toBe('4, a|b.ts');
    expect(displayValues([''])).toBe('(empty)');
  });

  it('renders a key tuple as one line', () => {
    expect(displayKey(['7'])).toBe('7');
    expect(displayKey(['4', '9'])).toBe('4, 9');
  });
});

describe('conflict messages', () => {
  it('renders the overwrite-parent refusal byte for byte as the plan has always reported it', () => {
    const conflict: FkOverwriteConflict = { id: 'fk:contests', kind: 'fk-overwrite', table: 'contests', children: ['participations', 'tasks'] };
    expect(fkOverwriteConflictMessage(conflict)).toBe(
      '"contests" cannot be overwritten while participations, tasks reference it: this schema\'s foreign keys are not deferrable, so a per-table delete would break them. Skip participations, tasks or merge them instead.',
    );
  });

  it('renders the account-username refusal byte for byte as the privilege rules have always reported it', () => {
    const conflict: AccountUsernameConflict = {
      id: accountUsernameConflictId('admins', 7),
      kind: 'account-username',
      table: 'admins',
      index: 'admins_username_key',
      columns: ['username'],
      pair: { username: 'ada', stagedId: 7, liveId: 1 },
    };
    expect(accountUsernameConflictMessage(conflict)).toBe(
      '"admins" cannot be applied: "ada" (archive id 7, live id 1) exists in the archive and live under different ids, and "username" is unique, so the merge would violate it and roll the whole table back. Rename or remove one side of each pair, then validate again.',
    );
  });

  it('keeps only the one username it is about, so one prompt never stands for two rows', () => {
    const ada: AccountUsernameConflict = {
      id: accountUsernameConflictId('admins', 7),
      kind: 'account-username', table: 'admins', index: 'admins_username_key', columns: ['username'],
      pair: { username: 'ada', stagedId: 7, liveId: 1 },
    };
    const grace: AccountUsernameConflict = {
      id: accountUsernameConflictId('admins', 8),
      kind: 'account-username', table: 'admins', index: 'admins_username_key', columns: ['username'],
      pair: { username: 'grace', stagedId: 8, liveId: 2 },
    };
    expect(ada.id).not.toBe(grace.id);
    expect(accountUsernameConflictMessage(ada)).toContain('"ada" (archive id 7, live id 1)');
    expect(accountUsernameConflictMessage(grace)).toContain('"grace" (archive id 8, live id 2)');
  });

  it('renders a unique conflict with the table, the index, the value and the two keys', () => {
    const [conflict] = detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['ada'], ['7'])], [valueRow(['ada'], ['1'])]);
    const message = uniqueValueConflictMessage(conflict!);
    expect(message).toContain('"admins" already holds "ada" in admins_username_key');
    expect(message).toContain('archive row 7 and the live row 1');
    expect(message).toContain('"username" is unique');
    expect(message).toContain('rolling the table back');
  });

  it('dispatches on the conflict kind', () => {
    const fk: FkOverwriteConflict = { id: 'fk:contests', kind: 'fk-overwrite', table: 'contests', children: ['tasks'] };
    expect(conflictMessage(fk)).toBe(fkOverwriteConflictMessage(fk));
    const [unique] = detectUniqueConflicts(ADMINS_USERNAME_INDEX, [valueRow(['ada'], ['7'])], [valueRow(['ada'], ['1'])]);
    expect(conflictMessage(unique!)).toBe(uniqueValueConflictMessage(unique!));
    const account: AccountUsernameConflict = {
      id: accountUsernameConflictId('admins', 7), kind: 'account-username', table: 'admins', index: 'admins_username_key', columns: ['username'],
      pair: { username: 'ada', stagedId: 7, liveId: 1 },
    };
    expect(conflictMessage(account)).toBe(accountUsernameConflictMessage(account));
  });
});

describe('buildRestoreStrategies', () => {
  it('merges every selected table for Apply Append', () => {
    expect(buildRestoreStrategies(['contests', 'users'], 'append')).toEqual({ contests: 'merge', users: 'merge' });
  });

  it('overwrites every selected table for Apply Replace', () => {
    expect(buildRestoreStrategies(['contests', 'users'], 'replace')).toEqual({ contests: 'overwrite', users: 'overwrite' });
  });

  it('resolves nothing for an empty selection', () => {
    expect(buildRestoreStrategies([], 'append')).toEqual({});
    expect(buildRestoreStrategies([], 'replace')).toEqual({});
  });

  it('gives every table the same strategy, so no table is left to a per-table default', () => {
    const strategies = buildRestoreStrategies(['a', 'b', 'c'], 'append');
    expect(new Set(Object.values(strategies))).toEqual(new Set(['merge']));
  });
});

describe('the unique check bound', () => {
  it('caps each side of a check at a named limit', () => {
    expect(UNIQUE_CHECK_ROW_LIMIT).toBe(5_000);
  });
});

describe('isPrivilegeOwnedIndex', () => {
  it('claims admins.username, which the privilege rules report instead', () => {
    expect(isPrivilegeOwnedIndex(ADMINS_USERNAME_INDEX)).toBe(true);
  });

  it('leaves every other index to the generic check', () => {
    expect(isPrivilegeOwnedIndex(TOKENS_OPAQUE_INDEX)).toBe(false);
    expect(isPrivilegeOwnedIndex({ table: 'admins', name: 'admins_name_key', columns: ['name'] })).toBe(false);
    expect(isPrivilegeOwnedIndex({ table: 'users', name: 'users_username_key', columns: ['username'] })).toBe(false);
  });
});

describe('parseUniqueValueRows', () => {
  it('reads the value-and-key pairs the check query returns', () => {
    expect(parseUniqueValueRows('[ [["ada"],["7"]], [["grace"],["8"]] ]')).toEqual([
      { values: ['ada'], key: ['7'] },
      { values: ['grace'], key: ['8'] },
    ]);
  });

  it('reads a composite value and key as whole arrays', () => {
    expect(parseUniqueValueRows('[[["4","a|b.ts"],["88","9"]]]')).toEqual([
      { values: ['4', 'a|b.ts'], key: ['88', '9'] },
    ]);
  });

  it('reads an empty document as no rows', () => {
    expect(parseUniqueValueRows('[]')).toEqual([]);
    expect(parseUniqueValueRows('')).toEqual([]);
  });

  it('refuses a document that is not an array of rows', () => {
    expect(() => parseUniqueValueRows('{"a":1}')).toThrow(/JSON array/);
  });

  it('refuses a row that is not a value-and-key pair', () => {
    expect(() => parseUniqueValueRows('[[["ada"]]]')).toThrow(/pair/);
    expect(() => parseUniqueValueRows('["ada"]')).toThrow(/pair/);
  });

  it('refuses a value that is not text, because the query already excluded NULLs', () => {
    expect(() => parseUniqueValueRows('[[[null],["7"]]]')).toThrow(/not text/);
  });

  it('keeps a numeric or boolean value as its text', () => {
    expect(parseUniqueValueRows('[[[7,true],["1"]]]')).toEqual([{ values: ['7', 'true'], key: ['1'] }]);
  });
});

describe('uniqueCheckWasTruncated', () => {
  it('is true when a side read as many rows as it was allowed', () => {
    expect(uniqueCheckWasTruncated([valueRow(['ada'], ['1'])], 1)).toBe(true);
  });

  it('is false when the side finished inside its allowance', () => {
    expect(uniqueCheckWasTruncated([], 1)).toBe(false);
    expect(uniqueCheckWasTruncated([valueRow(['ada'], ['1']), valueRow(['grace'], ['2'])], 5)).toBe(false);
  });
});

describe('scratch resolution statements', () => {
  it('deletes the archive row on its whole key, which is how keep-live resolves a conflict', () => {
    expect(scratchDeleteRowSql('admins', ['id'], ['7'])).toBe('DELETE FROM "public"."admins" WHERE "id" = \'7\'');
    expect(scratchDeleteRowSql('submission_results', ['submission_id', 'dataset_id'], ['4', '9'])).toBe(
      'DELETE FROM "public"."submission_results" WHERE ("submission_id", "dataset_id") = (\'4\', \'9\')',
    );
  });

  it('rewrites the key on the scratch copy, which is how take-archive lands the upsert on the live row', () => {
    expect(scratchUpdateKeySql('admins', ['id'], ['7'], ['1'])).toBe('UPDATE "public"."admins" SET "id" = \'1\' WHERE "id" = \'7\'');
    expect(scratchUpdateKeySql('user_test_results', ['user_test_id', 'dataset_id'], ['5', '9'], ['1', '9'])).toBe(
      'UPDATE "public"."user_test_results" SET "user_test_id" = \'1\', "dataset_id" = \'9\' WHERE ("user_test_id", "dataset_id") = (\'5\', \'9\')',
    );
  });

  it('rewrites one value of one row, which is how autogenerate resolves a conflict', () => {
    expect(scratchUpdateValueSql('executables', ['id'], ['7'], 'name', 'runner-2')).toBe(
      'UPDATE "public"."executables" SET "name" = \'runner-2\' WHERE "id" = \'7\'',
    );
  });

  it('escapes an apostrophe in a value rather than ending the literal', () => {
    expect(scratchUpdateValueSql('executables', ['id'], ['7'], 'name', "it's")).toContain("'it''s'");
    expect(scratchDeleteRowSql('files', ['filename'], ["o'k.txt"])).toContain("'o''k.txt'");
  });

  it('refuses a column and a value list that do not line up', () => {
    expect(() => scratchDeleteRowSql('admins', ['id', 'name'], ['7'])).toThrow(/value/);
    expect(() => scratchUpdateKeySql('admins', ['id'], ['7'], [])).toThrow(/value/);
    expect(() => scratchUpdateKeySql('admins', ['id'], ['7'], ['1', '2'])).toThrow(/value/);
  });

  it('refuses an identifier outside the allowlist', () => {
    expect(() => scratchDeleteRowSql('admins; DROP TABLE users', ['id'], ['1'])).toThrow(/identifier/);
    expect(() => scratchUpdateValueSql('admins', ['id'], ['1'], 'name; --', 'x')).toThrow(/identifier/);
  });

  it('carries a rename and its cascade as one transaction with foreign-key triggers off', () => {
    const sql = scratchRewriteBatchSql([
      { table: 'admins', sql: scratchUpdateKeySql('admins', ['id'], ['7'], ['1']) },
      { table: 'admin_groups', sql: scratchUpdateKeySql('admin_groups', ['admin_id'], ['7'], ['1']) },
    ]);
    expect(sql).toContain('BEGIN');
    expect(sql).toContain('SET LOCAL session_replication_role = replica');
    expect(sql).toContain('COMMIT');
    expect(sql.indexOf('"public"."admins"')).toBeLessThan(sql.indexOf('"public"."admin_groups"'));
  });

  it('refuses an empty rewrite batch', () => {
    expect(() => scratchRewriteBatchSql([])).toThrow(/no statements/);
  });
});

describe('parseFkEdges', () => {
  it('groups a composite constraint back into one edge, keeping column order', () => {
    const edges = parseFkEdges([
      { constraint: 'submission_results_submission_id_fkey', childTable: 'submission_results', childColumn: 'submission_id', parentTable: 'submissions', parentColumn: 'id' },
      { constraint: 'submission_results_dataset_id_fkey', childTable: 'submission_results', childColumn: 'dataset_id', parentTable: 'datasets', parentColumn: 'id' },
    ]);
    expect(edges).toEqual([
      { constraint: 'submission_results_submission_id_fkey', childTable: 'submission_results', childColumns: ['submission_id'], parentTable: 'submissions', parentColumns: ['id'] },
      { constraint: 'submission_results_dataset_id_fkey', childTable: 'submission_results', childColumns: ['dataset_id'], parentTable: 'datasets', parentColumns: ['id'] },
    ]);
  });

  it('pairs both columns of a two-column constraint positionally', () => {
    const edges = parseFkEdges([
      { constraint: 'evaluations_result_fkey', childTable: 'evaluations', childColumn: 'result_submission_id', parentTable: 'submission_results', parentColumn: 'submission_id' },
      { constraint: 'evaluations_result_fkey', childTable: 'evaluations', childColumn: 'result_dataset_id', parentTable: 'submission_results', parentColumn: 'dataset_id' },
    ]);
    expect(edges).toEqual([
      { constraint: 'evaluations_result_fkey', childTable: 'evaluations', childColumns: ['result_submission_id', 'result_dataset_id'], parentTable: 'submission_results', parentColumns: ['submission_id', 'dataset_id'] },
    ]);
  });

  it('reads nothing from no rows', () => {
    expect(parseFkEdges([])).toEqual([]);
  });
});

describe('planKeyRenameCascade', () => {
  const ADMINS_TO_GROUPS: FkEdge = { constraint: 'admin_groups_admin_id_fkey', childTable: 'admin_groups', childColumns: ['admin_id'], parentTable: 'admins', parentColumns: ['id'] };
  const MESSAGES_TO_ADMINS: FkEdge = { constraint: 'messages_admin_id_fkey', childTable: 'messages', childColumns: ['admin_id'], parentTable: 'admins', parentColumns: ['id'] };
  const SUBMISSION_RESULTS_TO_SUBMISSIONS: FkEdge = { constraint: 'submission_results_submission_id_fkey', childTable: 'submission_results', childColumns: ['submission_id'], parentTable: 'submissions', parentColumns: ['id'] };
  const EVALUATIONS_TO_RESULTS: FkEdge = { constraint: 'evaluations_result_fkey', childTable: 'evaluations', childColumns: ['result_submission_id', 'result_dataset_id'], parentTable: 'submission_results', parentColumns: ['submission_id', 'dataset_id'] };
  const ALL = ['admins', 'admin_groups', 'messages', 'submissions', 'submission_results', 'evaluations'];

  it('starts from the renamed row and follows every child that points at it', () => {
    const steps = planKeyRenameCascade([ADMINS_TO_GROUPS, MESSAGES_TO_ADMINS], ALL, { table: 'admins', columns: ['id'], fromValues: ['7'], toValues: ['1'] });
    expect(steps.map((step) => step.table)).toEqual(['admins', 'admin_groups', 'messages']);
    expect(steps.map((step) => step.columns)).toEqual([['id'], ['admin_id'], ['admin_id']]);
    for (const step of steps) expect(step.toValues).toEqual(['1']);
  });

  it('follows a child whose own key changed, so the rows pointing at it move too', () => {
    const steps = planKeyRenameCascade([SUBMISSION_RESULTS_TO_SUBMISSIONS, EVALUATIONS_TO_RESULTS], ALL, { table: 'submissions', columns: ['id'], fromValues: ['7'], toValues: ['1'] });
    expect(steps.map((step) => step.table)).toEqual(['submissions', 'submission_results', 'evaluations']);
    expect(steps[2]?.columns).toEqual(['result_submission_id']);
    expect(steps[2]?.fromValues).toEqual(['7']);
    expect(steps[2]?.toValues).toEqual(['1']);
  });

  it('follows a child that references only some of the rewritten columns, rewriting just those', () => {
    const steps = planKeyRenameCascade([EVALUATIONS_TO_RESULTS], ALL, {
      table: 'submission_results',
      columns: ['submission_id', 'dataset_id'],
      fromValues: ['5', '9'],
      toValues: ['1', '9'],
    });
    expect(steps[1]).toEqual({ table: 'evaluations', columns: ['result_submission_id', 'result_dataset_id'], fromValues: ['5', '9'], toValues: ['1', '9'] });
  });

  it('rewrites only the column that changed when the child references the whole composite key', () => {
    const steps = planKeyRenameCascade([EVALUATIONS_TO_RESULTS], ALL, {
      table: 'submission_results',
      columns: ['submission_id'],
      fromValues: ['5'],
      toValues: ['1'],
    });
    expect(steps[1]).toEqual({ table: 'evaluations', columns: ['result_submission_id'], fromValues: ['5'], toValues: ['1'] });
  });

  it('does not follow a child that is not being applied', () => {
    const steps = planKeyRenameCascade([ADMINS_TO_GROUPS, MESSAGES_TO_ADMINS], ['admins', 'messages'], { table: 'admins', columns: ['id'], fromValues: ['7'], toValues: ['1'] });
    expect(steps.map((step) => step.table)).toEqual(['admins', 'messages']);
  });

  it('ignores an edge whose parent columns are not the ones being rewritten', () => {
    const steps = planKeyRenameCascade([ADMINS_TO_GROUPS], ALL, { table: 'admins', columns: ['name'], fromValues: ['ada'], toValues: ['grace'] });
    expect(steps.map((step) => step.table)).toEqual(['admins']);
  });

  it('stops on a reference cycle instead of looping forever', () => {
    const tasksToDatasets: FkEdge = { constraint: 'tasks_active_dataset_id_fkey', childTable: 'tasks', childColumns: ['active_dataset_id'], parentTable: 'datasets', parentColumns: ['id'] };
    const datasetsToTasks: FkEdge = { constraint: 'datasets_task_id_fkey', childTable: 'datasets', childColumns: ['task_id'], parentTable: 'tasks', parentColumns: ['id'] };
    const steps = planKeyRenameCascade([tasksToDatasets, datasetsToTasks], ['tasks', 'datasets'], { table: 'tasks', columns: ['id'], fromValues: ['7'], toValues: ['1'] });
    expect(steps.map((step) => step.table)).toEqual(['tasks', 'datasets']);
  });

  it('names the depth it is willing to follow', () => {
    expect(MAX_CASCADE_DEPTH).toBeGreaterThan(1);
  });
});

describe('bundle safety', () => {
  /**
   * The confirmation popup builds the strategy record and renders the conflict
   * messages in a client component, so this module must stay reachable without
   * the preview store's `node:os` chain. Nothing else would catch a later import
   * that quietly made it server-only again.
   */
  it('keeps the conflict vocabulary free of the preview store chain', () => {
    const source = readFileSync(new URL('../src/lib/restore-apply-conflicts.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '@\/lib\/restore-preview/);
    expect(source).not.toMatch(/from 'node:/);
    expect(source).toMatch(/import type \{[^}]*\} from '@\/lib\/restore-apply';/);
  });

  it('keeps the identifier rules a leaf module', () => {
    const source = readFileSync(new URL('../src/lib/sql-identifier.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import /m);
  });

  /**
   * A client component that reaches the barrel for a value pulls `node:os` in and
   * breaks the browser build. Its types may come from the barrel, because those
   * are erased, but every value import has to name the leaf module.
   */
  it('has client components take the conflict vocabulary from the leaf module', () => {
    for (const file of ['RestoreConflictDialog.tsx']) {
      const source = readFileSync(new URL(`../src/components/backup-restore/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain("from '@/lib/restore-apply-conflicts'");
      expect(source, file).not.toMatch(/import \{[^}]*\} from '@\/lib\/restore-apply';/);
    }
  });
});
