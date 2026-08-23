import { getTask } from '@/app/actions/tasks';
import { notFound, redirect } from 'next/navigation';
import { TaskDetailView } from '@/components/tasks/TaskDetailView';
import { checkPermission } from '@/lib/permissions';

type DatasetRecord = {
  memory_limit: bigint | null;
  testcases: unknown[];
  managers: unknown[];
  task_type_parameters: unknown;
  score_type_parameters: unknown;
  [key: string]: unknown;
};

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key in value as Record<string, unknown>) {
      if (key === 'datasets_datasets_task_idTotasks') continue;
      result[key] = serializeValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }): Promise<React.JSX.Element> {
  const { id, locale } = await params;
  if (!(await checkPermission('tasks', false))) redirect(`/${locale}`);
  const taskId = parseInt(id, 10);
  if (Number.isNaN(taskId)) notFound();
  const task = await getTask(taskId);
  if (!task) notFound();

  const cleanTask = {
    ...task,
    contests: task.contests
      ? { ...task.contests, start: task.contests.start.toISOString(), stop: task.contests.stop.toISOString(), analysis_start: task.contests.analysis_start.toISOString(), analysis_stop: task.contests.analysis_stop.toISOString() }
      : null,
    statements: Array.isArray(task.statements) ? task.statements : [],
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    datasets: (Array.isArray(task.datasets_datasets_task_idTotasks) ? task.datasets_datasets_task_idTotasks : []).map((ds) => {
      const record = ds as unknown as DatasetRecord;
      return {
        ...record,
        memory_limit: record.memory_limit ? record.memory_limit.toString() : null,
        testcases: Array.isArray(record.testcases) ? record.testcases : [],
        managers: Array.isArray(record.managers) ? record.managers : [],
        task_type_parameters: record.task_type_parameters ?? {},
        score_type_parameters: record.score_type_parameters ?? {},
      };
    }),
    submission_format: Array.isArray(task.submission_format) ? task.submission_format : [],
    primary_statements: Array.isArray(task.primary_statements) ? task.primary_statements : [],
    allowed_languages: Array.isArray(task.allowed_languages) ? task.allowed_languages : [],
    datasets_datasets_task_idTotasks: undefined,
  };

  const serializedTask = serializeValue(cleanTask);

  return (
    <div className="space-y-8">
      <TaskDetailView task={serializedTask as Parameters<typeof TaskDetailView>[0]['task']} />
    </div>
  );
}
