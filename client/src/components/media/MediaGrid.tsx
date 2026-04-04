import { useRef, useCallback, useEffect, useState } from 'react';
import type { MediaItem } from '../../types/media';
import { MediaCard } from './MediaCard';
import { Camera } from 'lucide-react';

interface Props {
  items: MediaItem[];
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onRangeSelect?: (ids: string[]) => void;
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

/** Detect current grid column count from a grid container element */
function getGridColumns(el: HTMLElement | null): number {
  if (!el) return 1;
  const style = getComputedStyle(el);
  const cols = style.gridTemplateColumns.split(' ').length;
  return cols || 1;
}

export function MediaGrid({ items, selectMode, selectedIds, onToggleSelect, onRangeSelect, onSelect, onDownload, onDelete, onAddToAlbum, groupByDate = true }: Props) {
  const lastClickedIndexRef = useRef<number>(-1);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation: Shift + Arrow keys for range selection
  useEffect(() => {
    if (!selectMode || focusIndex < 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!arrowKeys.includes(e.key)) return;

      e.preventDefault();

      // Find the first grid element to get column count
      const gridEl = gridRef.current?.querySelector('.grid') as HTMLElement | null;
      const cols = getGridColumns(gridEl);

      let nextIndex = focusIndex;
      switch (e.key) {
        case 'ArrowRight': nextIndex = Math.min(items.length - 1, focusIndex + 1); break;
        case 'ArrowLeft': nextIndex = Math.max(0, focusIndex - 1); break;
        case 'ArrowDown': nextIndex = Math.min(items.length - 1, focusIndex + cols); break;
        case 'ArrowUp': nextIndex = Math.max(0, focusIndex - cols); break;
      }

      if (nextIndex !== focusIndex && nextIndex >= 0 && nextIndex < items.length) {
        // Add the item at nextIndex to selection
        const id = items[nextIndex].id;
        if (!selectedIds?.has(id)) {
          onRangeSelect ? onRangeSelect([id]) : onToggleSelect?.(id);
        }
        setFocusIndex(nextIndex);

        // Scroll the new item into view
        const cards = gridEl?.children;
        if (cards && cards[nextIndex]) {
          (cards[nextIndex] as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectMode, focusIndex, items, selectedIds, onRangeSelect, onToggleSelect]);

  // Reset focus when leaving select mode
  useEffect(() => {
    if (!selectMode) setFocusIndex(-1);
  }, [selectMode]);

  const handleItemClick = useCallback((item: MediaItem, e: React.MouseEvent) => {
    if (!selectMode) {
      onSelect?.(item);
      return;
    }

    const currentIndex = items.indexOf(item);

    // Shift+click: range select from last clicked to current
    if (e.shiftKey && lastClickedIndexRef.current >= 0 && onRangeSelect) {
      const start = Math.min(lastClickedIndexRef.current, currentIndex);
      const end = Math.max(lastClickedIndexRef.current, currentIndex);
      const rangeIds = items.slice(start, end + 1).map(i => i.id);
      onRangeSelect(rangeIds);
    } else {
      onToggleSelect?.(item.id);
    }

    lastClickedIndexRef.current = currentIndex;
    setFocusIndex(currentIndex);
  }, [items, selectMode, onToggleSelect, onRangeSelect, onSelect]);

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
      {gridItems.map(item => {
        const idx = items.indexOf(item);
        return (
          <MediaCard
            key={item.id} item={item} selectMode={selectMode} selected={selectedIds?.has(item.id)}
            focused={selectMode && idx === focusIndex}
            onToggleSelect={(e) => handleItemClick(item, e)} onClick={() => onSelect?.(item)}
            onDownload={onDownload ? () => onDownload(item) : undefined}
            onDelete={onDelete ? () => onDelete(item) : undefined}
            onAddToAlbum={onAddToAlbum ? () => onAddToAlbum(item) : undefined}
          />
        );
      })}
    </div>
  );

  if (!groupByDate) return <div ref={gridRef}>{renderGrid(items)}</div>;

  const groups = groupByMonth(items);
  return (
    <div ref={gridRef} className="space-y-6">
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
