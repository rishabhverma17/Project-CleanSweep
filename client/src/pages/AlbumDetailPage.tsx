import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { albumApi } from '../api/albumApi';
import { mediaApi, shareApi } from '../api/mediaApi';
import { familyApi, type FamilyDto } from '../api/familyApi';
import { MediaGrid } from '../components/media/MediaGrid';
import { MediaViewer } from '../components/media/MediaViewer';
import { useTrackedTask } from '../hooks/useTrackedTask';
import type { MediaItem } from '../types/media';
import { ArrowLeft, Check, Download, Undo2, Trash2, Camera, EyeOff, Eye, Pencil, Link2, Copy, Users, Lock, Unlock } from 'lucide-react';

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
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameDesc, setRenameDesc] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [shareExpiry, setShareExpiry] = useState(72);
  const [shareLink, setShareLink] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [showFamilyShare, setShowFamilyShare] = useState(false);
  const [families, setFamilies] = useState<FamilyDto[]>([]);
  const [albumPassword, setAlbumPassword] = useState<string | undefined>(undefined);
  const [passwordPrompt, setPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['album', albumId, albumPassword],
    queryFn: () => albumPassword ? albumApi.getByIdWithPassword(albumId!, albumPassword) : albumApi.getById(albumId!),
    enabled: !!albumId,
    retry: (failureCount, error: any) => {
      // Don't retry on 403 (password required) or 401 (wrong password)
      if (error?.response?.status === 403 || error?.response?.status === 401) return false;
      return failureCount < 2;
    },
  });

  // Show password prompt on 403
  useEffect(() => {
    if (queryError && (queryError as any)?.response?.status === 403) {
      setPasswordPrompt(true);
    }
  }, [queryError]);

  const handlePasswordSubmit = async () => {
    if (!albumId || !passwordInput) return;
    try {
      await albumApi.unlock(albumId, passwordInput);
      setAlbumPassword(passwordInput);
      setPasswordPrompt(false);
      setPasswordInput('');
      setPasswordError('');
    } catch {
      setPasswordError('Incorrect password');
    }
  };

  const handleSetPassword = async () => {
    if (!albumId) return;
    await albumApi.setPassword(albumId, newPassword || null);
    setShowSetPassword(false);
    setNewPassword('');
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  };

  const sortedMedia = useMemo(() => data ? sortMedia(data.media, sort) : [], [data, sort]);

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

  const handleDownloadAlbum = async () => {
    if (sortedMedia.length === 0) return;
    const ids = sortedMedia.map(m => m.id);
    await runTask(`Downloading album "${data?.album.name}"`, async () => {
      if (ids.length === 1) await mediaApi.download(ids[0]);
      else await mediaApi.downloadBatch(ids);
    });
  };

  const handleDownload = (item: MediaItem) => {
    runTask(`Downloading "${item.fileName}"`, () => mediaApi.download(item.id));
  };

  const handleRename = async () => {
    if (!albumId || !renameName.trim()) return;
    await albumApi.rename(albumId, renameName.trim(), renameDesc.trim() || undefined);
    setShowRename(false);
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  };

  const handleCreateShareLink = async () => {
    if (!albumId) return;
    const result = await shareApi.create(undefined, albumId, shareExpiry);
    const link = `${window.location.origin}/shared/${result.token}`;
    setShareLink(link);
  };

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleOpenFamilyShare = async () => {
    const fams = await familyApi.getMyFamilies();
    setFamilies(fams);
    setShowFamilyShare(true);
  };

  const handleShareToFamily = async (familyId: string) => {
    if (!albumId) return;
    setShowFamilyShare(false);
    await runTask(`Sharing album "${data?.album.name}" to family`, async () => {
      try {
        await familyApi.shareAlbum(familyId, albumId);
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message || 'Failed to share album';
        throw new Error(msg);
      }
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      queryClient.invalidateQueries({ queryKey: ['families'] });
    });
  };

  const handleToggleHidden = async () => {
    if (!albumId) return;
    await albumApi.toggleHidden(albumId);
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['media'] });
  };

  const handleDeleteAlbum = async () => {
    if (!albumId || !data) return;
    const choice = window.prompt(
      `Delete album "${data.album.name}"?\n\nType:\n  "album" — delete album only (keep photos)\n  "all" — delete album AND all its photos\n  Cancel to abort`
    );
    if (!choice) return;
    const deleteMedia = choice.trim().toLowerCase() === 'all';
    await runTask(`Deleting album "${data.album.name}"${deleteMedia ? ' and all media' : ''}`, async () => {
      await albumApi.deleteAlbum(albumId, deleteMedia);
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      if (deleteMedia) queryClient.invalidateQueries({ queryKey: ['media'] });
    });
    navigate('/albums');
  };

  if (isLoading) return <div className="text-zinc-500 py-20 text-center">Loading...</div>;

  // Password prompt for protected albums
  if (passwordPrompt) {
    return (
      <div className="max-w-sm mx-auto py-20">
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <Lock size={40} className="mx-auto mb-4" style={{ color: 'var(--accent)' }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Password Protected</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>This album requires a password to view.</p>
          <input
            type="password"
            placeholder="Enter password"
            value={passwordInput}
            onChange={e => { setPasswordInput(e.target.value); setPasswordError(''); }}
            onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            className="w-full px-4 py-2 rounded-lg mb-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}
            autoFocus
          />
          {passwordError && <p className="text-xs text-red-400 mb-2">{passwordError}</p>}
          <div className="flex gap-3 justify-center mt-3">
            <button onClick={() => navigate('/albums')} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Back</button>
            <button onClick={handlePasswordSubmit} className="px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>Unlock</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-zinc-500 py-20 text-center">Album not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <button onClick={() => navigate('/albums')} className="text-zinc-500 hover:text-white text-sm mb-1 transition flex items-center gap-1"><ArrowLeft size={14} /> Albums</button>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            {data.album.name}
            <button
              onClick={() => { setRenameName(data.album.name); setRenameDesc(data.album.description || ''); setShowRename(true); }}
              className="text-zinc-600 hover:text-zinc-300 transition p-1"
              title="Rename album"
            >
              <Pencil size={16} />
            </button>
            {data.album.isHidden && (
              <span className="ml-1 text-sm font-normal px-2 py-0.5 rounded-full align-middle" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                <EyeOff size={12} className="inline mr-1" />Hidden
              </span>
            )}
            {data.album.isPasswordProtected && (
              <span className="ml-1 text-sm font-normal px-2 py-0.5 rounded-full align-middle" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                <Lock size={12} className="inline mr-1" />Locked
              </span>
            )}
          </h2>
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
          {selectMode && (
            <button
              onClick={() => {
                if (selectedIds.size === sortedMedia.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(sortedMedia.map(m => m.id)));
                }
              }}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white rounded-md text-sm transition"
            >
              {selectedIds.size === sortedMedia.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
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
          {sortedMedia.length > 0 && (
            <button onClick={handleDownloadAlbum} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md text-sm transition flex items-center gap-1">
              <Download size={14} /> Download Album
            </button>
          )}
          <button onClick={() => { setShowShare(true); setShareLink(''); setShareCopied(false); }} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md text-sm transition flex items-center gap-1">
            <Link2 size={14} /> Share
          </button>
          <button onClick={handleOpenFamilyShare} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md text-sm transition flex items-center gap-1">
            <Users size={14} /> Share to Family
          </button>
          <button onClick={handleToggleHidden} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md text-sm transition flex items-center gap-1">
            {data.album.isHidden ? <><Eye size={14} /> Unhide</> : <><EyeOff size={14} /> Hide</>}
          </button>
          <button onClick={() => { setShowSetPassword(true); setNewPassword(''); }} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md text-sm transition flex items-center gap-1">
            {data.album.isPasswordProtected ? <><Unlock size={14} /> Change Password</> : <><Lock size={14} /> Set Password</>}
          </button>
          <button onClick={handleDeleteAlbum} className="px-3 py-1.5 bg-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded-md text-xs transition flex items-center gap-1">
            <Trash2 size={12} /> Delete Album
          </button>
        </div>
      </div>

      {/* Rename Modal */}
      {showRename && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowRename(false)}>
          <div className="rounded-xl p-6 w-full max-w-md" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Rename Album</h3>
            <input
              type="text"
              placeholder="Album name"
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              className="w-full px-4 py-2 rounded-lg mb-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
              autoFocus
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={renameDesc}
              onChange={e => setRenameDesc(e.target.value)}
              className="w-full px-4 py-2 rounded-lg mb-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowRename(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={handleRename} className="px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      {showShare && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowShare(false)}>
          <div className="rounded-xl p-6 w-full max-w-md" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Share Album</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Create a public link anyone can use to view this album.
            </p>
            <div className="mb-4">
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Link expires in</label>
              <select
                value={shareExpiry}
                onChange={e => { setShareExpiry(Number(e.target.value)); setShareLink(''); }}
                className="w-full px-3 py-2 rounded-lg text-sm text-white focus:outline-none"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
              >
                <option value={1}>1 hour</option>
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
                <option value={720}>30 days</option>
              </select>
            </div>
            {shareLink ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="flex-1 bg-transparent text-sm outline-none"
                    style={{ color: 'var(--text-primary)' }}
                  />
                  <button onClick={handleCopyShareLink} className="flex-shrink-0 p-1 transition" style={{ color: shareCopied ? '#4ade80' : 'var(--accent)' }}>
                    {shareCopied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {shareCopied ? 'Copied to clipboard!' : 'Share this link with anyone to give them view access.'}
                </p>
              </div>
            ) : (
              <button onClick={handleCreateShareLink} className="w-full px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>
                Generate Share Link
              </button>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowShare(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Share to Family Modal */}
      {showFamilyShare && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowFamilyShare(false)}>
          <div className="rounded-xl p-6 w-full max-w-md" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Share to Family</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Share all {sortedMedia.length} item(s) from this album to a family's shared pool.
            </p>
            {families.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                <Users size={32} className="mx-auto mb-2" />
                <p className="text-sm">No families found. Create or join a family first.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {families.map(family => (
                  <button
                    key={family.id}
                    onClick={() => handleShareToFamily(family.id)}
                    className="w-full text-left px-4 py-3 rounded-lg transition hover:brightness-125 flex items-center justify-between"
                    style={{ background: 'var(--card-bg)' }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{family.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{family.memberCount} members · {family.mediaCount} shared</p>
                    </div>
                    <Users size={16} style={{ color: 'var(--text-muted)' }} />
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowFamilyShare(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {showSetPassword && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowSetPassword(false)}>
          <div className="rounded-xl p-6 w-full max-w-sm" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {data.album.isPasswordProtected ? 'Change Password' : 'Set Password'}
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              {data.album.isPasswordProtected
                ? 'Enter a new password or leave empty to remove protection.'
                : 'Protect this album with a password. Anyone viewing it will need to enter the password first.'}
            </p>
            <input
              type="password"
              placeholder={data.album.isPasswordProtected ? 'New password (empty to remove)' : 'Enter password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg mb-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSetPassword(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              {data.album.isPasswordProtected && (
                <button onClick={() => { setNewPassword(''); handleSetPassword(); }} className="px-4 py-2 rounded-lg text-sm transition text-red-400 hover:bg-red-500/10">
                  Remove Password
                </button>
              )}
              <button onClick={handleSetPassword} className="px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>
                {newPassword ? 'Save' : data.album.isPasswordProtected ? 'Remove' : 'Set'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          onRangeSelect={rangeSelect}
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
