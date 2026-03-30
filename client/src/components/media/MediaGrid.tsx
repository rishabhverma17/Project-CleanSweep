import type { MediaItem } from '../../types/media';
import { MediaCard } from './MediaCard';
import { Camera } from 'lucide-react';

interface Props {
  items: MediaItem[];
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelect?: (item: MediaItem) => void;
  onDownload?: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  onAddToAlbum?: (item: MediaItem) => void;
  groupByDate?: boolean;
}

function groupByMonth(items: MediaItem[]): [string, MediaItem[]][] {
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const date = item.capturedAt ? new Date(item.capturedAt) : new Date(item.uploadedAt);
    const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  return [...groups.entries()];
}

export function MediaGrid({ items, selectMode, selectedIds, onToggleSelect, onSelect, onDownload, onDelete, onAddToAlbum, groupByDate = true }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
        <Camera size={48} className="mb-4" />
        <p className="text-lg">No media yet</p>
        <p className="text-sm mt-1">Drop files anywhere to upload</p>
      </div>
    );
  }

  const renderGrid = (gridItems: MediaItem[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-1">
      {gridItems.map(item => (
        <MediaCard
          key={item.id} item={item} selectMode={selectMode} selected={selectedIds?.has(item.id)}
          onToggleSelect={() => onToggleSelect?.(item.id)} onClick={() => onSelect?.(item)}
          onDownload={onDownload ? () => onDownload(item) : undefined}
          onDelete={onDelete ? () => onDelete(item) : undefined}
          onAddToAlbum={onAddToAlbum ? () => onAddToAlbum(item) : undefined}
        />
      ))}
    </div>
  );

  if (!groupByDate) return renderGrid(items);

  const groups = groupByMonth(items);
  return (
    <div className="space-y-6">
      {groups.map(([label, groupItems]) => (
        <div key={label}>
          <div className="sticky top-0 z-10 py-2 mb-2" style={{ background: 'var(--content-bg)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</h3>
          </div>
          {renderGrid(groupItems)}
        </div>
      ))}
    </div>
  );
}
