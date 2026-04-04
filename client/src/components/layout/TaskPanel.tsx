import { useTaskStore, type BackgroundTask } from '../../stores/taskStore';
import { useUploadStore } from '../../stores/uploadStore';
import { Loader2, CheckCircle2, XCircle, X, ClipboardList, Upload } from 'lucide-react';

function TaskItem({ task }: { task: BackgroundTask }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex-shrink-0">
        {task.status === 'running' && <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />}
        {task.status === 'done' && <CheckCircle2 size={18} style={{ color: '#4ade80' }} />}
        {task.status === 'error' && <XCircle size={18} style={{ color: '#f87171' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{task.label}</p>
        {task.status === 'running' && task.progress !== undefined && (
          <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${task.progress}%`, background: 'var(--accent)' }} />
          </div>
        )}
        {task.status === 'running' && task.progress === undefined && (
          <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full animate-pulse w-2/3" style={{ background: 'var(--accent)' }} />
          </div>
        )}
        {task.error && <p className="text-xs text-red-400 mt-0.5 truncate">{task.error}</p>}
      </div>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
        {task.status === 'running' && (task.progress !== undefined ? `${task.progress}%` : 'Working...')}
        {task.status === 'done' && 'Done'}
        {task.status === 'error' && 'Failed'}
      </span>
    </div>
  );
}

export function TaskPanel() {
  const { tasks, isOpen, toggle, clearDone } = useTaskStore();
  const { uploads, isUploading, clearCompleted: clearUploads } = useUploadStore();
  const uploadDone = uploads.filter(u => u.status === 'done').length;
  const uploadTotal = uploads.length;
  const uploadFailed = uploads.filter(u => u.status === 'error').length;
  const uploadProgress = uploadTotal > 0 ? Math.round((uploadDone / uploadTotal) * 100) : 0;

  const runningCount = tasks.filter(t => t.status === 'running').length + (isUploading ? 1 : 0);
  const hasCompleted = tasks.some(t => t.status !== 'running') || (uploadTotal > 0 && !isUploading);

  return (
    <>
      <button
        onClick={toggle}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all"
        style={{
          background: runningCount > 0 ? 'var(--accent)' : 'var(--card-bg)',
          color: runningCount > 0 ? '#1a1a1a' : 'var(--text-secondary)',
          border: `1px solid ${runningCount > 0 ? 'var(--accent)' : 'var(--border)'}`,
        }}
      >
        {runningCount > 0 ? (
          <>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#1a1a1a' }} />
              <span className="relative inline-flex rounded-full h-3 w-3" style={{ background: '#1a1a1a' }} />
            </span>
            <span className="text-sm font-medium">{runningCount} task{runningCount > 1 ? 's' : ''}</span>
          </>
        ) : (
          <span className="text-sm"><ClipboardList size={16} className="inline mr-1" /> Tasks {tasks.length > 0 ? `(${tasks.length})` : ''}</span>
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-32 md:bottom-20 right-4 md:right-6 z-50 w-80 md:w-96 max-h-[50vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Tasks</h3>
            <div className="flex gap-2">
              {hasCompleted && (
                <button onClick={() => { clearDone(); clearUploads(); }} className="text-xs transition" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'} onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}>Clear done</button>
              )}
              <button onClick={toggle} className="text-lg leading-none transition" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'} onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}><X size={18} /></button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {uploadTotal > 0 && (
              <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex-shrink-0">
                  {isUploading ? <Upload size={18} className="animate-pulse" style={{ color: 'var(--accent)' }} /> : uploadFailed > 0 ? <XCircle size={18} style={{ color: '#f87171' }} /> : <CheckCircle2 size={18} style={{ color: '#4ade80' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                    Uploading {uploadDone}/{uploadTotal} files
                    {uploadFailed > 0 && <span className="text-red-400 ml-1">({uploadFailed} failed)</span>}
                  </p>
                  {isUploading && (
                    <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%`, background: 'var(--accent)' }} />
                    </div>
                  )}
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {isUploading ? `${uploadProgress}%` : 'Done'}
                </span>
              </div>
            )}
            {tasks.length === 0 && uploadTotal === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No tasks</div>
            ) : (
              tasks.map(task => <TaskItem key={task.id} task={task} />)
            )}
          </div>
        </div>
      )}
    </>
  );
}
