import type { MediaItem } from '../../types/media';
import { Upload, Clock, Settings, RefreshCw, XCircle, Video, Image, Check, Play, Download, FolderPlus, Trash2 } from 'lucide-react';

interface Props {
  item: MediaItem;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onClick?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onAddToAlbum?: () => void;
}

const statusBadge: Record<number, React.ReactNode> = {
  0: <Upload size={14} />, 1: <Clock size={14} />, 2: <Settings size={14} />, 3: <RefreshCw size={14} />, 5: <XCircle size={14} />,
};

export function MediaCard({ item, selectMode, selected, onToggleSelect, onClick, onDownload, onDelete, onAddToAlbum }: Props) {
  const badge = statusBadge[item.processingStatus];
  const isVideo = item.mediaType === 1;

  const handleClick = () => {
    if (selectMode) onToggleSelect?.();
    else onClick?.();
  };

  return (
    <div
      className="relative aspect-square rounded-md overflow-hidden cursor-pointer transition-all group"
      style={{
        background: 'var(--card-bg)',
        outline: selected ? '2px solid var(--accent)' : 'none',
        outlineOffset: '-2px',
      }}
      onClick={handleClick}
    >
      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt={item.fileName} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
          {isVideo ? <Video size={32} /> : <Image size={32} />}
        </div>
      )}

      {/* Select checkbox */}
      {selectMode && (
        <div
          className="absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition"
          style={{
            background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.5)',
            borderColor: selected ? 'var(--accent)' : 'rgba(255,255,255,0.6)',
          }}
        >
          {selected && <Check size={12} style={{ color: '#1a1a1a' }} />}
        </div>
      )}

      {/* Video duration */}
      {isVideo && !badge && (
        <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
          <Play size={10} /> {item.durationSeconds ? `${Math.round(item.durationSeconds)}s` : 'Video'}
        </div>
      )}

      {/* Status badge */}
      {badge && (
        <div className="absolute top-2 right-2 bg-black/70 text-white text-sm px-1.5 py-0.5 rounded">{badge}</div>
      )}

      {/* Hover overlay */}
      {!selectMode && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
          <p className="text-xs text-white truncate mb-1.5">{item.fileName}</p>
          <div className="flex gap-1">
            {onDownload && (
              <button onClick={e => { e.stopPropagation(); onDownload(); }} className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs text-white backdrop-blur-sm transition"><Download size={14} /></button>
            )}
            {onAddToAlbum && (
              <button onClick={e => { e.stopPropagation(); onAddToAlbum(); }} className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs text-white backdrop-blur-sm transition"><FolderPlus size={14} /></button>
            )}
            {onDelete && (
              <button onClick={e => { e.stopPropagation(); onDelete(); }} className="px-2 py-1 bg-red-500/40 hover:bg-red-500/60 rounded text-xs text-white backdrop-blur-sm transition"><Trash2 size={14} /></button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
