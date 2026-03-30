import { useToastStore } from '../../stores/toastStore';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export function ToastBar() {
  const { toasts, remove } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] flex flex-col items-center gap-2 pt-3 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl max-w-lg w-full mx-4 animate-slide-down"
          style={{
            background: toast.type === 'error' ? 'rgba(127,29,29,0.95)' : toast.type === 'success' ? 'rgba(20,83,45,0.95)' : 'rgba(30,58,138,0.95)',
            border: `1px solid ${toast.type === 'error' ? 'rgba(248,113,113,0.3)' : toast.type === 'success' ? 'rgba(74,222,128,0.3)' : 'rgba(96,165,250,0.3)'}`,
            color: '#fff',
          }}
        >
          {toast.type === 'error' && <AlertCircle size={18} className="flex-shrink-0" style={{ color: '#f87171' }} />}
          {toast.type === 'success' && <CheckCircle2 size={18} className="flex-shrink-0" style={{ color: '#4ade80' }} />}
          {toast.type === 'info' && <Info size={18} className="flex-shrink-0" style={{ color: '#60a5fa' }} />}
          <p className="text-sm flex-1">{toast.message}</p>
          <button onClick={() => remove(toast.id)} className="flex-shrink-0 opacity-60 hover:opacity-100 transition">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
