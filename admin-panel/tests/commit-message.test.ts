import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { validateCommitMessage } from '../scripts/__check_commit_message';

const scratch = mkdtempSync(join(tmpdir(), 'commit-message-'));

afterEach((): void => {
  rmSync(join(scratch, 'message.txt'), { force: true });
});

afterAll((): void => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('validateCommitMessage', () => {
  it('accepts a short conventional subject and a factual body', (): void => {
    expect(validateCommitMessage('fix(contests): localize task empty state\n\nThe empty state was English text.')).toEqual([]);
  });

  it('rejects a subject longer than fifty characters', (): void => {
    expect(validateCommitMessage('fix(contests): the task empty state reads from the dictionary')[0]).toContain('maximum is 50');
  });

  it.each(['now', 'currently'] as const)('rejects filler word %s', (word: string): void => {
    expect(validateCommitMessage(`fix(contests): localize task empty state\n\nThe empty state ${word} reads Thai.`)).toContainEqual(expect.stringContaining('filler'));
  });

  it('rejects a first-person body and commit narration', (): void => {
    const message = 'fix(contests): localize task empty state\n\nI changed the empty state. This commit changes copy.';
    expect(validateCommitMessage(message)).toEqual(expect.arrayContaining([
      expect.stringContaining('first person'),
      expect.stringContaining('narrates the commit'),
    ]));
  });

  it('rejects a non-conventional subject and a forbidden trailer', (): void => {
    const message = 'localize task empty state\n\nCo-Authored-By: Someone <someone@example.test>';
    expect(validateCommitMessage(message)).toEqual(expect.arrayContaining([
      expect.stringContaining('type(scope)'),
      expect.stringContaining('forbidden trailer'),
    ]));
  });

  it('exits nonzero for a dead message file', (): void => {
    const path = join(scratch, 'message.txt');
    writeFileSync(path, 'fix(contests): this subject is deliberately longer than fifty characters');
    const result = spawnSync('bun', [join(process.cwd(), 'scripts/__check_commit_message.ts'), path], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commit message rejected');
  });
});
