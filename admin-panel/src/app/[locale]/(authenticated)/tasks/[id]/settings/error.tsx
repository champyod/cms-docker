'use client';

import { TaskTabError } from '@/components/tasks/task-detail/TaskTabError';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <TaskTabError title="Task settings could not be loaded" reset={reset} />;
}
