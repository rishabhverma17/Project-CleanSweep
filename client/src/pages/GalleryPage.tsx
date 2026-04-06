import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMediaBrowse } from '../hooks/useMedia';
import { MediaGrid } from '../components/media/MediaGrid';
import { MediaViewer } from '../components/media/MediaViewer';
import { mediaApi } from '../api/mediaApi';
import { albumApi } from '../api/albumApi';
import { familyApi } from '../api/familyApi';
import { useTrackedTask } from '../hooks/useTrackedTask';
import type { MediaItem } from '../types/media';
import { Check, Download, FolderPlus, Users, Trash2 } from 'lucide-react';

export function GalleryPage() {
  const [sort, setSort] = useState<string>('captured_desc');
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useMediaBrowse(50, undefined, sort);
  const { data: albums } = useQuery({ queryKey: ['albums'], queryFn: albumApi.getAll });
  const { data: families } = useQuery({ queryKey: ['families'], queryFn: familyApi.getMyFamilies });
  const queryClient = useQueryClient();
  const { runTask } = useTrackedTask();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [showFamilyPicker, setShowFamilyPicker] = useState(false);
  const [albumPickerForSingle, setAlbumPickerForSingle] = useState<string | null>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { threshold: 0.1 }
    );
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const allItems = data?.pages.flatMap(p => p.items) ?? [];

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

  const handleDelete = async (item: MediaItem) => {
    if (!confirm(`Delete "${item.fileName}"?`)) return;
    await runTask(`Deleting "${item.fileName}"`, async () => {
      await mediaApi.deleteMedia(item.id);
      queryClient.invalidateQueries({ queryKey: ['media'] });
    });
  };

  const handleDownload = (item: MediaItem) => {
    runTask(`Downloading "${item.fileName}"`, () => mediaApi.download(item.id));
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setSelectMode(false);
    await runTask(`Deleting ${ids.length} item(s)`, async () => {
      await mediaApi.deleteBatch(ids);
      queryClient.invalidateQueries({ queryKey: ['media'] });
    });
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await runTask(`Downloading ${ids.length} file(s)`, async () => {
      if (ids.length === 1) await mediaApi.download(ids[0]);
      else await mediaApi.downloadBatch(ids);
    });
  };

  const handleAddToAlbum = async (albumId: string) => {
    const ids = albumPickerForSingle ? [albumPickerForSingle] : [...selectedIds];
    const albumName = albums?.find(a => a.id === albumId)?.name || 'album';
    setShowAlbumPicker(false);
    setAlbumPickerForSingle(null);
    setSelectedIds(new Set());
    setSelectMode(false);
    await runTask(`Adding ${ids.length} photo(s) to "${albumName}"`, async () => {
      await albumApi.addMedia(albumId, ids);
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      queryClient.invalidateQueries({ queryKey: ['album'] });
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-20 text-zinc-500">Loading...</div>;
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Gallery</h2>
          <span className="text-sm text-zinc-500">{data?.pages[0]?.totalCount ?? 0} items</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="bg-zinc-800 text-zinc-300 text-sm rounded-md px-2 py-1.5 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className={`px-3 py-1.5 rounded-md text-sm transition ${selectMode ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
          >
            {selectMode ? <><Check size={14} className="inline mr-1" />{selectedIds.size} selected</> : 'Select'}
          </button>
          {selectMode && (
            <button
              onClick={() => {
                if (selectedIds.size === allItems.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(allItems.map(m => m.id)));
                }
              }}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white rounded-md text-sm transition"
            >
              {selectedIds.size === allItems.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {selectMode && selectedIds.size > 0 && (
            <>
              <button onClick={handleDownloadSelected} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-md text-sm text-white transition flex items-center gap-1">
                <Download size={14} /> ({selectedIds.size})
              </button>
              <button onClick={() => { setAlbumPickerForSingle(null); setShowAlbumPicker(true); }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-md text-sm text-white transition flex items-center gap-1">
                <FolderPlus size={14} /> ({selectedIds.size})
              </button>
              <button onClick={() => setShowFamilyPicker(true)} className="px-3 py-1.5 rounded-md text-sm text-white transition flex items-center gap-1" style={{ background: '#7c3aed' }}>
                <Users size={14} /> Family ({selectedIds.size})
              </button>
              <button onClick={handleDeleteSelected} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md text-sm text-white transition flex items-center gap-1">
                <Trash2 size={14} /> ({selectedIds.size})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Album Picker Modal */}
      {showAlbumPicker && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowAlbumPicker(false); setAlbumPickerForSingle(null); }}>
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-sm border border-zinc-700" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Add to Album</h3>
            {(!albums || albums.length === 0) ? (
              <p className="text-zinc-500 text-sm">No albums yet. Create one first.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {albums.map(album => (
                  <button key={album.id} onClick={() => handleAddToAlbum(album.id)}
                    className="w-full text-left px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition flex justify-between">
                    <span>{album.name}</span>
                    <span className="text-xs text-zinc-500">{album.mediaCount}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setShowAlbumPicker(false); setAlbumPickerForSingle(null); }} className="mt-4 w-full text-zinc-400 hover:text-white text-sm transition">Cancel</button>
          </div>
        </div>
      )}

      {/* Family Picker Modal */}
      {showFamilyPicker && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowFamilyPicker(false)}>
          <div className="rounded-xl p-6 w-full max-w-sm" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Share to Family</h3>
            {(!families || families.length === 0) ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No families yet. Create one in the Families page.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {families.map((family: any) => (
                  <button key={family.id} onClick={async () => {
                    const ids = [...selectedIds];
                    setShowFamilyPicker(false);
                    setSelectedIds(new Set());
                    setSelectMode(false);
                    await runTask(`Sharing ${ids.length} photo(s) to "${family.name}"`, async () => {
                      await familyApi.shareMedia(family.id, ids);
                      queryClient.invalidateQueries({ queryKey: ['families'] });
                    });
                  }}
                    className="w-full text-left px-4 py-3 rounded-lg transition flex justify-between" style={{ background: 'var(--card-bg)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{family.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{family.memberCount} members</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowFamilyPicker(false)} className="mt-4 w-full text-sm transition" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Media Grid */}
      <MediaGrid
        items={allItems}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRangeSelect={rangeSelect}
        onSelect={item => !selectMode && setSelectedItem(item)}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onAddToAlbum={(item) => { setAlbumPickerForSingle(item.id); setShowAlbumPicker(true); }}
        groupByDate={sort === 'captured_desc' || sort === 'captured_asc'}
      />

      {/* Infinite scroll loader */}
      <div ref={loaderRef} className="py-8 text-center">
        {isFetchingNextPage && <span className="text-zinc-500 text-sm">Loading more...</span>}
      </div>

      {/* Lightbox */}
      {selectedItem && (
        <MediaViewer
          item={selectedItem}
          items={allItems}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
          onDownload={() => handleDownload(selectedItem)}
          onDelete={async () => {
            if (!confirm('Delete this item?')) return;
            const item = selectedItem;
            setSelectedItem(null);
            await runTask(`Deleting "${item.fileName}"`, async () => {
              await mediaApi.deleteMedia(item.id);
              queryClient.invalidateQueries({ queryKey: ['media'] });
            });
          }}
        />
      )}
    </div>
  );
}
