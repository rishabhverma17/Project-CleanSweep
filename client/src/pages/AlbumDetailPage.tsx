import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { albumApi } from '../api/albumApi';
import { mediaApi } from '../api/mediaApi';
import { MediaGrid } from '../components/media/MediaGrid';
import { MediaViewer } from '../components/media/MediaViewer';
import { useTrackedTask } from '../hooks/useTrackedTask';
import type { MediaItem } from '../types/media';
import { ArrowLeft, Check, Download, Undo2, Trash2, Camera } from 'lucide-react';

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

export function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runTask } = useTrackedTask();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sort, setSort] = useState('captured_desc');

  const { data, isLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => albumApi.getById(albumId!),
    enabled: !!albumId,
  });

  const sortedMedia = useMemo(() => data ? sortMedia(data.media, sort) : [], [data, sort]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRemoveFromAlbum = async (mediaId: string) => {
    if (!albumId) return;
    if (!confirm('Remove this photo from the album?')) return;
    await albumApi.removeMedia(albumId, mediaId);
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  };

  const handleRemoveSelected = async () => {
    if (!albumId || selectedIds.size === 0) return;
    if (!confirm(`Remove ${selectedIds.size} item(s) from album?`)) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setSelectMode(false);
    await runTask(`Removing ${ids.length} item(s) from album`, async () => {
      for (const id of ids) await albumApi.removeMedia(albumId, id);
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      queryClient.invalidateQueries({ queryKey: ['albums'] });
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

  const handleDownload = (item: MediaItem) => {
    runTask(`Downloading "${item.fileName}"`, () => mediaApi.download(item.id));
  };

  const handleDeleteAlbum = async () => {
    if (!albumId || !data) return;
    const choice = window.prompt(
      `Delete album "${data.album.name}"?\n\nType:\n  "album" — delete album only (keep photos)\n  "all" — delete album AND all its photos\n  Cancel to abort`
    );
    if (!choice) return;
    const deleteMedia = choice.trim().toLowerCase() === 'all';
    await albumApi.deleteAlbum(albumId, deleteMedia);
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    navigate('/albums');
  };

  if (isLoading) return <div className="text-zinc-500 py-20 text-center">Loading...</div>;
  if (!data) return <div className="text-zinc-500 py-20 text-center">Album not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <button onClick={() => navigate('/albums')} className="text-zinc-500 hover:text-white text-sm mb-1 transition flex items-center gap-1"><ArrowLeft size={14} /> Albums</button>
          <h2 className="text-2xl font-bold">{data.album.name}</h2>
          {data.album.description && <p className="text-zinc-500 text-sm">{data.album.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-500">{sortedMedia.length} items</span>
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
          {selectMode && selectedIds.size > 0 && (
            <>
              <button onClick={handleDownloadSelected} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-md text-sm text-white transition flex items-center gap-1">
                <Download size={14} /> ({selectedIds.size})
              </button>
              <button onClick={handleRemoveSelected} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded-md text-sm text-white transition flex items-center gap-1">
                <Undo2 size={14} /> Remove ({selectedIds.size})
              </button>
            </>
          )}
          <button onClick={handleDeleteAlbum} className="px-3 py-1.5 bg-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded-md text-xs transition flex items-center gap-1">
            <Trash2 size={12} /> Delete Album
          </button>
        </div>
      </div>

      {/* Grid */}
      {sortedMedia.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <Camera size={40} className="mb-4" />
          <p>No photos in this album. Add some from Gallery → Select → Add to Album.</p>
        </div>
      ) : (
        <MediaGrid
          items={sortedMedia}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelect={item => !selectMode && setSelectedItem(item)}
          onDownload={handleDownload}
          onDelete={item => handleRemoveFromAlbum(item.id)}
          groupByDate={sort === 'captured_desc' || sort === 'captured_asc'}
        />
      )}

      {/* Lightbox */}
      {selectedItem && (
        <MediaViewer
          item={selectedItem}
          items={sortedMedia}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
          onDownload={() => handleDownload(selectedItem)}
          onDelete={async () => {
            handleRemoveFromAlbum(selectedItem.id);
            setSelectedItem(null);
          }}
          deleteLabel="Remove from Album"
        />
      )}
    </div>
  );
}
