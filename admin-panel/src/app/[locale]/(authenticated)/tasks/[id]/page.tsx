import { getTask } from '@/app/actions/tasks';
import { notFound } from 'next/navigation';
import { TaskDetailView } from '@/components/tasks/TaskDetailView';

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  
  if (isNaN(taskId)) {
    notFound();
  }

  const task = await getTask(taskId);

  if (!task) {
    notFound();
  }

  // Sanitize and transform the task object to safely pass to client component
  const cleanTask = {
    ...task,
    contests: task.contests ? {
      ...task.contests,
      start: task.contests.start.toISOString(),
      stop: task.contests.stop.toISOString(),
      analysis_start: task.contests.analysis_start.toISOString(),
      analysis_stop: task.contests.analysis_stop.toISOString(),
    } : null,
    statements: Array.isArray(task.statements) ? task.statements : [],
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    datasets: (Array.isArray(task.datasets_datasets_task_idTotasks) ? task.datasets_datasets_task_idTotasks : []).map(ds => ({
      ...ds,
      memory_limit: ds.memory_limit ? ds.memory_limit.toString() : null,
      testcases: Array.isArray(ds.testcases) ? ds.testcases : [],
      managers: Array.isArray(ds.managers) ? ds.managers : [],
      // Ensure JSON fields are plain objects
      task_type_parameters: ds.task_type_parameters ?? {},
      score_type_parameters: ds.score_type_parameters ?? {},
    })),
    submission_format: Array.isArray(task.submission_format) ? task.submission_format : [],
    primary_statements: Array.isArray(task.primary_statements) ? task.primary_statements : [],
    allowed_languages: Array.isArray(task.allowed_languages) ? task.allowed_languages : [],
    // Remove the original long property name to avoid confusion and reduce payload
    datasets_datasets_task_idTotasks: undefined,
  };

  // Final serialization pass to catch any remaining BigInts/Dates at root level
  const serialize = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(serialize);
    if (typeof obj === 'object') {
      const newObj: any = {};
      for (const key in obj) {
        if (key === 'datasets_datasets_task_idTotasks') continue; // Skip if still present
        newObj[key] = serialize(obj[key]);
      }
      return newObj;
    }
    return obj;
  };

  const serializedTask = serialize(cleanTask);

  return (
    <div className="space-y-8">
      <TaskDetailView task={serializedTask} />
    </div>
  );
}
