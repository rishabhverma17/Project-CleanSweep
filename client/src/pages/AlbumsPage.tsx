import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { albumApi } from '../api/albumApi';
import { FolderOpen, Trash2 } from 'lucide-react';

export function AlbumsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: albums, isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: albumApi.getAll,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    await albumApi.create(name.trim(), description.trim() || undefined);
    setName('');
    setDescription('');
    setShowCreate(false);
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  };

  const handleDeleteAlbum = async (albumId: string, albumName: string) => {
    const choice = window.prompt(
      `Delete album "${albumName}"?\n\nType:\n  "album" — delete album only (keep photos)\n  "all" — delete album AND all its photos\n  Cancel to abort`
    );
    if (!choice) return;
    const deleteMedia = choice.trim().toLowerCase() === 'all';
    await albumApi.deleteAlbum(albumId, deleteMedia);
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    if (deleteMedia) queryClient.invalidateQueries({ queryKey: ['media'] });
  };

  if (isLoading) return <div className="text-zinc-500 py-20 text-center">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Albums</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition"
        >
          + New Album
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">New Album</h3>
            <input
              type="text"
              placeholder="Album name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-zinc-400 hover:text-white transition">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition">Create</button>
            </div>
          </div>
        </div>
      )}

      {(!albums || albums.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <FolderOpen size={40} className="mb-4" />
          <p>No albums yet. Create one to organize your media!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {albums.map(album => (
            <div key={album.id} className="bg-zinc-900 rounded-lg overflow-hidden group relative cursor-pointer" onClick={() => navigate(`/albums/${album.id}`)}>
              <div className="aspect-video bg-zinc-800 flex items-center justify-center text-3xl">
                {album.coverThumbnailUrl ? (
                  <img src={album.coverThumbnailUrl} alt={album.name} className="w-full h-full object-cover" />
                ) : <FolderOpen size={32} style={{ color: 'var(--text-muted)' }} />}
              </div>
              <div className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium truncate">{album.name}</p>
                  <p className="text-xs text-zinc-500">{album.mediaCount} items</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteAlbum(album.id, album.name); }}
                  className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
