import { useEffect, useCallback, useState } from 'react';
import type { MediaItem } from '../../types/media';
import { X, ChevronLeft, ChevronRight, Calendar, Ruler, HardDrive, Download, Trash2, Share2, Check, Clock, Loader2, Copy } from 'lucide-react';
import { shareApi } from '../../api/mediaApi';
import { useToastStore } from '../../stores/toastStore';

function copyToClipboard(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  item: MediaItem;
  items?: MediaItem[];
  onClose: () => void;
  onNavigate?: (item: MediaItem) => void;
  onDownload?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}

export function MediaViewer({ item, items, onClose, onNavigate, onDownload, onDelete, deleteLabel }: Props) {
  const isVideo = item.mediaType === 1;
  const currentIndex = items?.findIndex(i => i.id === item.id) ?? -1;
  const hasPrev = items && currentIndex > 0;
  const hasNext = items && currentIndex < items.length - 1;
  const [shareState, setShareState] = useState<'idle' | 'picking' | 'copying' | 'done'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const addToast = useToastStore(s => s.add);

  const handleShare = async (expiryHours: number) => {
    setShareState('copying');
    try {
      const { token } = await shareApi.create(item.id, undefined, expiryHours);
      const url = `${window.location.origin}/shared/${token}`;
      setShareUrl(url);
      // Try clipboard API first, fall back to execCommand
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { copied = copyToClipboard(url); }
      if (copied) {
        addToast('success', 'Share link copied to clipboard!');
      } else {
        addToast('info', 'Share link created — copy it from the field below.');
      }
      setShareState('done');
    } catch (err: any) {
      console.error('Share failed:', err);
      addToast('error', err?.response?.data?.error || err?.message || 'Failed to create share link');
      setShareState('idle');
    }
  };

  const handleCopyShareUrl = () => {
    let copied = false;
    try { navigator.clipboard.writeText(shareUrl); copied = true; } catch { copied = copyToClipboard(shareUrl); }
    if (copied) addToast('success', 'Link copied!');
  };

  const goNext = useCallback(() => { if (hasNext && items && onNavigate) onNavigate(items[currentIndex + 1]); }, [hasNext, items, currentIndex, onNavigate]);
  const goPrev = useCallback(() => { if (hasPrev && items && onNavigate) onNavigate(items[currentIndex - 1]); }, [hasPrev, items, currentIndex, onNavigate]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.95)' }} onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 transition z-10" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'} onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}><X size={24} /></button>

      {hasPrev && (
        <button onClick={e => { e.stopPropagation(); goPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 transition z-10 p-2" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'} onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}><ChevronLeft size={36} /></button>
      )}
      {hasNext && (
        <button onClick={e => { e.stopPropagation(); goNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 transition z-10 p-2" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'} onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}><ChevronRight size={36} /></button>
      )}

      <div className="relative max-w-6xl max-h-[90vh] w-full mx-16" onClick={e => e.stopPropagation()}>
        {isVideo && item.playbackUrl ? (
          <video src={item.playbackUrl} controls autoPlay className="w-full max-h-[82vh] rounded-lg mx-auto" />
        ) : item.playbackUrl || item.thumbnailUrl ? (
          <img src={item.playbackUrl || item.thumbnailUrl} alt={item.fileName} className="w-full max-h-[82vh] object-contain rounded-lg mx-auto" />
        ) : (
          <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>Processing...</div>
        )}

        <div className="mt-3 flex items-center justify-between text-sm px-1" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="truncate max-w-xs">{item.fileName}</span>
            {items && <span style={{ color: 'var(--text-muted)' }}>{currentIndex + 1}/{items.length}</span>}
          </div>
          <div className="flex gap-2 items-center flex-shrink-0">
            {item.capturedAt && <span className="hidden sm:inline flex items-center gap-1"><Calendar size={14} /> {new Date(item.capturedAt).toLocaleDateString()}</span>}
            {item.width && item.height && <span className="hidden sm:inline flex items-center gap-1"><Ruler size={14} /> {item.width}×{item.height}</span>}
            <span className="flex items-center gap-1"><HardDrive size={14} /> {(item.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
            {onDownload && (
              <button onClick={onDownload} className="px-3 py-1 rounded text-white transition flex items-center gap-1" style={{ background: 'var(--card-bg)' }} onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--card-hover)'} onMouseLeave={e => (e.target as HTMLElement).style.background = 'var(--card-bg)'}><Download size={14} /></button>
            )}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); if (shareState === 'done') { setShareState('idle'); setShareUrl(''); } else { setShareState(shareState === 'picking' ? 'idle' : 'picking'); } }} className="px-3 py-1 rounded text-white transition flex items-center gap-1" style={{ background: shareState === 'done' ? 'rgba(74,222,128,0.2)' : 'var(--card-bg)' }}>
                {shareState === 'done' ? <><Check size={14} /> Shared</> : shareState === 'copying' ? <><Loader2 size={14} className="animate-spin" /> Sharing...</> : <><Share2 size={14} /> Share</>}
              </button>
              {shareState === 'picking' && (
                <div className="absolute bottom-full right-0 mb-2 rounded-lg shadow-xl overflow-hidden min-w-[140px]" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                  <p className="text-xs px-3 py-2 font-medium" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Link expires in</p>
                  {[{ label: '1 hour', hours: 1 }, { label: '24 hours', hours: 24 }, { label: '7 days', hours: 168 }, { label: '30 days', hours: 720 }].map(opt => (
                    <button key={opt.hours} onClick={(e) => { e.stopPropagation(); handleShare(opt.hours); }} className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <Clock size={12} /> {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {shareState === 'done' && shareUrl && (
                <div className="absolute bottom-full right-0 mb-2 rounded-lg shadow-xl p-2 min-w-[280px]" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <input type="text" readOnly value={shareUrl} className="flex-1 px-2 py-1.5 rounded text-xs text-white focus:outline-none" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }} onClick={e => (e.target as HTMLInputElement).select()} />
                    <button onClick={handleCopyShareUrl} className="p-1.5 rounded transition hover:bg-white/10" style={{ color: 'var(--text-secondary)' }}><Copy size={14} /></button>
                  </div>
                </div>
              )}
            </div>
            {onDelete && (
              <button onClick={onDelete} className="px-3 py-1 rounded text-white transition bg-red-800 hover:bg-red-700 flex items-center gap-1"><Trash2 size={14} /> {deleteLabel || 'Delete'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
