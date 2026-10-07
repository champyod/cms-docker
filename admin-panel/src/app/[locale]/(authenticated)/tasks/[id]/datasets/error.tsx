'use client';

import { TaskTabError } from '@/components/tasks/task-detail/TaskTabError';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <TaskTabError title="Task datasets could not be loaded" reset={reset} />;
}
