import { prisma } from '@/lib/prisma';

export interface TaskDiagnostic {
  type: 'error' | 'warning';
  message: string;
}

export function buildDiagnosticsForLoadedTask(task: {
  active_dataset_id: number | null;
  contest_id: number | null;
  statements: Array<{ id: number }>;
  datasets_datasets_task_idTotasks: Array<{ id: number; _count: { testcases: number } }>;
}): TaskDiagnostic[] {
  const diagnostics: TaskDiagnostic[] = [];
  if (!task.active_dataset_id) {
    diagnostics.push({ type: 'error', message: 'No active dataset selected.' });
  } else {
    const activeDataset = task.datasets_datasets_task_idTotasks.find((d) => d.id === task.active_dataset_id);
    if (!activeDataset) diagnostics.push({ type: 'error', message: 'Active dataset not found.' });
    else if (activeDataset._count.testcases === 0) diagnostics.push({ type: 'error', message: 'Active dataset has no test cases.' });
  }
  if (task.statements.length === 0) diagnostics.push({ type: 'error', message: 'No statements found.' });
  if (!task.contest_id) diagnostics.push({ type: 'warning', message: 'Not assigned to any contest.' });
  return diagnostics;
}

export async function computeTaskDiagnostics(taskId: number): Promise<TaskDiagnostic[]> {
  const task = await prisma.tasks.findUnique({
    where: { id: taskId },
    include: {
      statements: { select: { id: true } },
      datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true } } } },
    },
  });
  if (!task) return [];
  const diagnostics: TaskDiagnostic[] = [];
  if (!task.active_dataset_id) {
    diagnostics.push({ type: 'error', message: 'No active dataset selected. Task cannot be judged.' });
  }
  const activeDataset = task.active_dataset_id
    ? await prisma.datasets.findUnique({
        where: { id: task.active_dataset_id },
        include: { testcases: { select: { id: true } } },
      })
    : null;
  if (task.active_dataset_id && (!activeDataset?.testcases || activeDataset.testcases.length === 0)) {
    diagnostics.push({ type: 'error', message: 'Active dataset has no test cases.' });
  }
  if (task.statements.length === 0) {
    diagnostics.push({ type: 'error', message: "No statements found. Users won't see instructions." });
  }
  if (!task.contest_id) {
    diagnostics.push({ type: 'warning', message: 'Not assigned to any contest.' });
  }
  return diagnostics;
}
