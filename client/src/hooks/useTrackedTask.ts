import { useCallback } from 'react';
import { useTaskStore } from '../stores/taskStore';

export function useTrackedTask() {
  const { addTask, updateTask } = useTaskStore();

  const runTask = useCallback(
    async <T,>(label: string, fn: (taskId: string) => Promise<T>): Promise<T | undefined> => {
      const taskId = crypto.randomUUID();
      addTask(taskId, label);
      try {
        const result = await fn(taskId);
        updateTask(taskId, { status: 'done', progress: 100 });
        return result;
      } catch (err: any) {
        updateTask(taskId, { status: 'error', error: err.message || 'Failed' });
        return undefined;
      }
    },
    [addTask, updateTask],
  );

  const setProgress = useCallback(
    (taskId: string, progress: number) => {
      updateTask(taskId, { progress });
    },
    [updateTask],
  );

  return { runTask, setProgress };
}
