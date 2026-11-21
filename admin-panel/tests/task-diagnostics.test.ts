import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueTask, findUniqueDataset } = vi.hoisted(() => ({
  findUniqueTask: vi.fn(),
  findUniqueDataset: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tasks: { findUnique: findUniqueTask },
    datasets: { findUnique: findUniqueDataset },
  },
}));

import { buildDiagnosticsForLoadedTask, computeTaskDiagnostics } from '@/lib/task-diagnostics';

const HEALTHY_DATASET = { id: 1, _count: { testcases: 3 } };

describe('statement diagnostic severity', () => {
  beforeEach(() => {
    findUniqueTask.mockReset();
    findUniqueDataset.mockReset();
  });

  it('reports a missing statement as a warning, not an error', () => {
    const diagnostics = buildDiagnosticsForLoadedTask({
      active_dataset_id: 1,
      contest_tasks: [{ contest_id: 5 }],
      statements: [],
      datasets_datasets_task_idTotasks: [HEALTHY_DATASET],
    });
    const statement = diagnostics.find((d) => d.message.startsWith('No statements'));
    expect(statement?.type).toBe('warning');
    expect(diagnostics.some((d) => d.type === 'error')).toBe(false);
  });

  it('stays silent once a statement exists', () => {
    const diagnostics = buildDiagnosticsForLoadedTask({
      active_dataset_id: 1,
      contest_tasks: [{ contest_id: 5 }],
      statements: [{ id: 9 }],
      datasets_datasets_task_idTotasks: [HEALTHY_DATASET],
    });
    expect(diagnostics.some((d) => d.message.startsWith('No statements'))).toBe(false);
  });

  it('warns when a task belongs to no contest', () => {
    const diagnostics = buildDiagnosticsForLoadedTask({
      active_dataset_id: 1,
      contest_tasks: [],
      statements: [{ id: 9 }],
      datasets_datasets_task_idTotasks: [HEALTHY_DATASET],
    });
    const contest = diagnostics.find((d) => d.message === 'Not assigned to any contest.');
    expect(contest?.type).toBe('warning');
  });

  it('reports the async diagnostic as a warning too', async () => {
    findUniqueTask.mockResolvedValue({
      id: 1,
      active_dataset_id: 1,
      contest_tasks: [{ contest_id: 5 }],
      statements: [],
    });
    findUniqueDataset.mockResolvedValue({ id: 1, testcases: [{ id: 1 }] });
    const diagnostics = await computeTaskDiagnostics(1);
    const statement = diagnostics.find((d) => d.message.startsWith('No statements'));
    expect(statement?.type).toBe('warning');
  });
});
