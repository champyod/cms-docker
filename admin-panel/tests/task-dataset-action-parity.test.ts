import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Why: vitest runs ESM where __dirname is undefined — derive it so the
// action-parity guards read the migrated sources from a stable root.
const testDir = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(testDir, '..', relativePath), 'utf8');
}

describe('task dataset action parity', () => {
  it('keeps clone and rename on their exact API routes with the existing copy', () => {
    const source = readSource('src/components/tasks/task-detail/useTaskDatasetActions.ts');
    expect(source).toContain('`/api/datasets/${datasetId}/clone`');
    expect(source).toContain('{ newDescription: clonedName }');
    expect(source).toContain("{ action: 'rename', description: renamedName }");
    expect(source).toContain("{ action: 'activate' }");
    expect(source).toContain("{ action: 'toggle-autojudge' }");
    expect(source).toContain('`/api/datasets/${datasetId}`');
    expect(source).toContain('`/api/testcases/${testcaseId}`');
    expect(source).toContain("{ action: 'toggle-public' }");
    expect(source).toContain('Cloning dataset...');
    expect(source).toContain('Dataset cloned');
    expect(source).toContain('Clone failed');
    expect(source).toContain('created successfully.');
    expect(source).toContain('Renaming dataset...');
    expect(source).toContain('Dataset renamed');
    expect(source).toContain('Rename failed');
    expect(source).toContain('Renamed to');
  });

  it('does not add a second local prompt primitive in the Task migration', () => {
    const source = readSource('src/components/tasks/task-detail/useTaskDatasetActions.ts');
    expect(source).not.toContain('NameDialog');
    expect(source).not.toContain('PromptDialog');
    expect(source).not.toContain('function Prompt');
    expect(source).toContain("window.prompt('Enter name for cloned dataset:'");
    expect(source).toContain("window.prompt('Enter new name:', description)");
    expect(source.match(/window\.prompt/g)).toHaveLength(2);
  });

  it('removes the old all-in-one task read from the service', () => {
    const source = readSource('src/lib/services/tasks.ts');
    expect(source).not.toContain('TaskDetailInclude');
    expect(source).not.toContain('TaskWithStatements');
    expect(source).not.toContain('EnrichedStatement');
    expect(source).not.toContain('enrichStatements');
    expect(source).not.toMatch(/getTask\(/);
    expect(source).toContain('listTasks');
  });

  it('removes the old getTask wrapper while keeping the tab-owned settings read', () => {
    const source = readSource('src/app/actions/tasks.ts');
    expect(source).not.toMatch(/getTask\(/);
    expect(source).toContain('getTaskSettings');
    expect(source).toContain('getTaskDiagnostics');
  });
});
