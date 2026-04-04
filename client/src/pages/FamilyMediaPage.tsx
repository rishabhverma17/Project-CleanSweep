import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { familyApi } from '../api/familyApi';
import { mediaApi } from '../api/mediaApi';
import { MediaGrid } from '../components/media/MediaGrid';
import { MediaViewer } from '../components/media/MediaViewer';
import { useTrackedTask } from '../hooks/useTrackedTask';
import type { MediaItem } from '../types/media';
import { ArrowLeft, Download, Check, Trash2 } from 'lucide-react';

function sortMedia(items: MediaItem[], sort: string): MediaItem[] {
  const sorted = [...items];
  switch (sort) {
    case 'captured_asc': return sorted.sort((a, b) => new Date(a.capturedAt || a.uploadedAt).getTime() - new Date(b.capturedAt || b.uploadedAt).getTime());
    case 'uploaded_desc': return sorted.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    case 'size_desc': return sorted.sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
    case 'type_photo': return sorted.sort((a, b) => a.mediaType - b.mediaType);
    case 'type_video': return sorted.sort((a, b) => b.mediaType - a.mediaType);
    default: return sorted.sort((a, b) => new Date(b.capturedAt || b.uploadedAt).getTime() - new Date(a.capturedAt || a.uploadedAt).getTime());
  }
}

export function FamilyMediaPage() {
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runTask } = useTrackedTask();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sort, setSort] = useState('captured_desc');

  const { data: families } = useQuery({ queryKey: ['families'], queryFn: familyApi.getMyFamilies });
  const family = families?.find(f => f.id === familyId);

  const { data, isLoading } = useQuery({
    queryKey: ['family-media', familyId],
    queryFn: () => familyApi.getFamilyMedia(familyId!, 1, 200),
    enabled: !!familyId,
  });

  const items: MediaItem[] = data?.items ?? [];
  const sortedItems = useMemo(() => sortMedia(items, sort), [items, sort]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const rangeSelect = (ids: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  };

  const handleDownload = (item: MediaItem) => {
    runTask(`Downloading "${item.fileName}"`, () => mediaApi.download(item.id));
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await runTask(`Downloading ${ids.length} file(s)`, async () => {
      if (ids.length === 1) await mediaApi.download(ids[0]);
      else await mediaApi.downloadBatch(ids);
    });
  };

  const handleUnshare = async (item: MediaItem) => {
    if (!familyId) return;
    if (!confirm(`Remove "${item.fileName}" from this family?`)) return;
    await familyApi.unshareMedia(familyId, item.id);
    queryClient.invalidateQueries({ queryKey: ['family-media', familyId] });
    queryClient.invalidateQueries({ queryKey: ['families'] });
  };

  const handleUnshareSelected = async () => {
    if (!familyId || selectedIds.size === 0) return;
    if (!confirm(`Remove ${selectedIds.size} item(s) from this family?`)) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setSelectMode(false);
    await runTask(`Removing ${ids.length} item(s) from family`, async () => {
      for (const id of ids) await familyApi.unshareMedia(familyId, id);
      queryClient.invalidateQueries({ queryKey: ['family-media', familyId] });
      queryClient.invalidateQueries({ queryKey: ['families'] });
    });
  };

  if (isLoading) return <div className="py-20 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <button onClick={() => navigate('/families')} className="text-sm mb-1 transition flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={14} /> Families
          </button>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{family?.name || 'Family'} — Shared Media</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{sortedItems.length} items</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <option value="captured_desc">Newest</option>
            <option value="captured_asc">Oldest</option>
            <option value="uploaded_desc">Recent uploads</option>
            <option value="size_desc">Largest</option>
            <option value="type_photo">Photos first</option>
            <option value="type_video">Videos first</option>
          </select>
          <button
            onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
            className={`px-3 py-1.5 rounded-md text-sm transition ${selectMode ? 'bg-blue-600 text-white' : ''}`}
            style={!selectMode ? { background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } : undefined}
          >
            {selectMode ? <><Check size={14} className="inline mr-1" />{selectedIds.size} selected</> : 'Select'}
          </button>
          {selectMode && selectedIds.size > 0 && (
            <>
              <button onClick={handleDownloadSelected} className="px-3 py-1.5 rounded-md text-sm text-white transition flex items-center gap-1" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <Download size={14} /> ({selectedIds.size})
              </button>
              <button onClick={handleUnshareSelected} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md text-sm text-white transition flex items-center gap-1">
                <Trash2 size={14} /> Remove ({selectedIds.size})
              </button>
            </>
          )}
        </div>
      </div>

      <MediaGrid
        items={sortedItems}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRangeSelect={rangeSelect}
        onSelect={item => !selectMode && setSelectedItem(item)}
        onDownload={handleDownload}
        onDelete={handleUnshare}
        groupByDate={sort === 'captured_desc' || sort === 'captured_asc'}
      />

      {selectedItem && (
        <MediaViewer
          item={selectedItem}
          items={sortedItems}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
          onDownload={() => handleDownload(selectedItem)}
          onDelete={async () => {
            await handleUnshare(selectedItem);
            setSelectedItem(null);
          }}
          deleteLabel="Remove"
        />
      )}
    </div>
  );
}
