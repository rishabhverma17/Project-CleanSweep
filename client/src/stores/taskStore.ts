import { create } from 'zustand';

export type TaskStatus = 'running' | 'done' | 'error';

export interface BackgroundTask {
  id: string;
  label: string;
  status: TaskStatus;
  progress?: number; // 0-100, optional
  error?: string;
  createdAt: number;
}

interface TaskStore {
  tasks: BackgroundTask[];
  isOpen: boolean;
  addTask: (id: string, label: string) => void;
  updateTask: (id: string, update: Partial<BackgroundTask>) => void;
  removeTask: (id: string) => void;
  clearDone: () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  isOpen: false,

  addTask: (id, label) =>
    set((state) => ({
      tasks: [{ id, label, status: 'running', createdAt: Date.now() }, ...state.tasks],
      isOpen: true, // auto-open when new task starts
    })),

  updateTask: (id, update) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...update } : t)),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  clearDone: () =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status === 'running'),
    })),

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
}));
