import { useCallback, useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { groupFilesByFolder, getTopLevelFolderName } from '../../hooks/useUpload';
import { useUploadStore } from '../../stores/uploadStore';
import { albumApi } from '../../api/albumApi';
import { useTrackedTask } from '../../hooks/useTrackedTask';
import { FolderOpen, FolderUp, RefreshCw, CheckCircle2, XCircle, Album, ArrowRight, ChevronDown, Search } from 'lucide-react';
import type { Album as AlbumType } from '../../types/media';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.mov', '.m4v']);

function filterSupportedFiles(files: File[]): File[] {
  return files.filter(f => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    return (f.type.startsWith('image/') || f.type.startsWith('video/')) && SUPPORTED_EXTENSIONS.has(ext);
  });
}

interface FolderPreview {
  files: File[];
  folderGroups: Map<string, File[]>;
  rootFiles: File[];
  topLevelFolderName?: string; // the selected folder name (for flat folders)
}

interface FolderAlbumAssignment {
  type: 'new' | 'existing';
  existingAlbumId?: string;
  existingAlbumName?: string;
}

interface Props {
  onComplete?: () => void;
}

export function MediaUploader({ onComplete }: Props) {
  const queryClient = useQueryClient();
  const { summary, startUpload, retryUpload, retryAllFailed, clearCompleted, getVisibleItems } = useUploadStore();
  const { runTask } = useTrackedTask();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderPreview, setFolderPreview] = useState<FolderPreview | null>(null);
  const [existingAlbums, setExistingAlbums] = useState<AlbumType[]>([]);
  const [folderAssignments, setFolderAssignments] = useState<Map<string, FolderAlbumAssignment>>(new Map());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [albumSearch, setAlbumSearch] = useState('');
  const [visibleOffset, setVisibleOffset] = useState(0);
  const VISIBLE_LIMIT = 50;

  // Fetch existing albums when folder preview modal opens
  useEffect(() => {
    if (folderPreview) {
      albumApi.getAll().then(setExistingAlbums).catch(() => setExistingAlbums([]));
      // Initialize all folders as "new album"
      const assignments = new Map<string, FolderAlbumAssignment>();
      for (const folder of folderPreview.folderGroups.keys()) {
        assignments.set(folder, { type: 'new' });
      }
      setFolderAssignments(assignments);
      setOpenDropdown(null);
      setAlbumSearch('');
    }
  }, [folderPreview]);

  const setFolderAssignment = (folder: string, assignment: FolderAlbumAssignment) => {
    setFolderAssignments(prev => {
      const next = new Map(prev);
      next.set(folder, assignment);
      return next;
    });
    setOpenDropdown(null);
    setAlbumSearch('');
  };

  const doneCount = summary.done;
  const failedCount = summary.error;
  const totalCount = summary.total;
  const visibleItems = getVisibleItems(visibleOffset, VISIBLE_LIMIT);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const supported = filterSupportedFiles(acceptedFiles);
    if (supported.length > 0) startUpload(supported, undefined, undefined, onComplete);
  }, [startUpload, onComplete]);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const supported = filterSupportedFiles(files);
    if (supported.length === 0) return;

    const folderGroups = groupFilesByFolder(supported);
    const rootFiles = folderGroups.get('__root__') || [];
    folderGroups.delete('__root__');
    const topLevelFolderName = getTopLevelFolderName(supported) ?? undefined;

    // Always show modal for folder uploads so user can create an album
    if (folderGroups.size > 0 || topLevelFolderName) {
      // If no subfolders, treat all root files as one album named after the folder
      if (folderGroups.size === 0 && topLevelFolderName) {
        folderGroups.set(topLevelFolderName, rootFiles);
        setFolderPreview({ files: supported, folderGroups, rootFiles: [], topLevelFolderName });
      } else {
        setFolderPreview({ files: supported, folderGroups, rootFiles, topLevelFolderName });
      }
    } else {
      startUpload(supported, undefined, undefined, onComplete);
    }

    if (folderInputRef.current) folderInputRef.current.value = '';
  }, [startUpload, onComplete]);

  const handleFolderUploadConfirm = async (createAlbums: boolean) => {
    if (!folderPreview) return;
    const { files, folderGroups } = folderPreview;
    setFolderPreview(null);

    if (!createAlbums) {
      // Upload flat — no albums
      startUpload(files, undefined, undefined, onComplete);
      return;
    }

    // Upload all files, then create/assign albums from folder structure
    const folderMediaMap = await startUpload(files, folderGroups, undefined, onComplete);

    if (folderMediaMap.size > 0) {
      const newCount = [...folderAssignments.values()].filter(a => a.type === 'new').length;
      const existingCount = [...folderAssignments.values()].filter(a => a.type === 'existing').length;
      const label = [
        newCount > 0 ? `Creating ${newCount} album(s)` : '',
        existingCount > 0 ? `Adding to ${existingCount} existing album(s)` : '',
      ].filter(Boolean).join(', ');

      await runTask(label || 'Assigning media to albums', async () => {
        for (const [folderName, mediaIds] of folderMediaMap) {
          if (mediaIds.length === 0) continue;
          const assignment = folderAssignments.get(folderName);
          try {
            if (assignment?.type === 'existing' && assignment.existingAlbumId) {
              await albumApi.addMedia(assignment.existingAlbumId, mediaIds);
            } else {
              const album = await albumApi.create(folderName);
              await albumApi.addMedia(album.id, mediaIds);
            }
          } catch (err) {
            console.error(`Failed to assign album "${folderName}":`, err);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['albums'] });
      });
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.heif'],
      'video/*': ['.mp4', '.mov', '.m4v'],
    },
  });

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition ${
          isDragActive ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-500'
        }`}
      >
        <input {...getInputProps()} />
        <FolderOpen size={40} className="mb-4 mx-auto" style={{ color: 'var(--text-muted)' }} />
        {isDragActive ? (
          <p className="text-blue-400">Drop files here...</p>
        ) : (
          <div>
            <p className="text-zinc-300">Drag & drop photos and videos here</p>
            <p className="text-zinc-500 text-sm mt-1">or click to browse files</p>
            <p className="text-zinc-600 text-xs mt-3">Supports: JPG, PNG, HEIC, MP4, MOV</p>
          </div>
        )}
      </div>

      {/* Folder upload button */}
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is not in React types */
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderSelect}
      />
      <button
        onClick={() => folderInputRef.current?.click()}
        className="w-full border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition border-zinc-700 hover:border-zinc-500 flex items-center justify-center gap-2"
      >
        <FolderUp size={20} style={{ color: 'var(--text-muted)' }} />
        <span className="text-zinc-400 text-sm">Upload entire folder</span>
        <span className="text-zinc-600 text-xs">(subfolders become albums)</span>
      </button>

      {/* Folder Preview Modal */}
      {folderPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setFolderPreview(null)}>
          <div className="rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Upload Folder</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              {folderPreview.files.length} files found. Subfolders will become albums.
            </p>

            {/* Folder → Album mapping preview */}
            <div className="space-y-2 mb-4">
              {[...folderPreview.folderGroups.entries()].map(([folder, files]) => {
                const assignment = folderAssignments.get(folder);
                const isDropdownOpen = openDropdown === folder;
                return (
                  <div key={folder} className="relative">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--card-bg)' }}>
                      <Album size={16} style={{ color: 'var(--accent)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{folder}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{files.length} file{files.length !== 1 ? 's' : ''}</p>
                      </div>
                      <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                      {/* Album assignment picker */}
                      <button
                        onClick={() => { setOpenDropdown(isDropdownOpen ? null : folder); setAlbumSearch(''); }}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full cursor-pointer transition hover:brightness-125"
                        style={{
                          background: assignment?.type === 'existing' ? 'rgba(74,222,128,0.15)' : 'rgba(138,180,248,0.15)',
                          color: assignment?.type === 'existing' ? '#4ade80' : 'var(--accent)',
                        }}
                      >
                        <span className="truncate max-w-[120px]">
                          {assignment?.type === 'existing' ? assignment.existingAlbumName : 'New Album'}
                        </span>
                        <ChevronDown size={12} />
                      </button>
                    </div>

                    {/* Dropdown for album selection */}
                    {isDropdownOpen && (
                      <div
                        className="absolute right-0 top-full mt-1 z-10 w-64 rounded-lg shadow-xl overflow-hidden"
                        style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}
                      >
                        <div
                          className="px-3 py-2 text-xs cursor-pointer transition hover:brightness-125 flex items-center gap-2"
                          style={{
                            color: 'var(--accent)',
                            background: assignment?.type === 'new' ? 'rgba(138,180,248,0.1)' : 'transparent',
                          }}
                          onClick={() => setFolderAssignment(folder, { type: 'new' })}
                        >
                          <Album size={14} />
                          <span className="font-medium">New Album</span>
                          <span style={{ color: 'var(--text-muted)' }}>"{folder}"</span>
                        </div>
                        {existingAlbums.length > 0 && (
                          <>
                            <div style={{ borderTop: '1px solid var(--border)' }}>
                              <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                                <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                  type="text"
                                  placeholder="Search albums..."
                                  value={albumSearch}
                                  onChange={e => setAlbumSearch(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  autoFocus
                                  className="w-full bg-transparent text-xs outline-none"
                                  style={{ color: 'var(--text-primary)' }}
                                />
                              </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {(() => {
                                const query = albumSearch.toLowerCase().trim();
                                const filtered = query
                                  ? existingAlbums.filter(a => a.name.toLowerCase().includes(query))
                                  : existingAlbums;
                                if (filtered.length === 0) {
                                  return (
                                    <div className="px-3 py-3 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                                      No albums match "{albumSearch}"
                                    </div>
                                  );
                                }
                                return (
                                  <>
                                    {filtered.map(album => (
                                      <div
                                        key={album.id}
                                        className="px-3 py-2 text-xs cursor-pointer transition hover:brightness-125 flex items-center gap-2"
                                        style={{
                                          color: 'var(--text-primary)',
                                          background: assignment?.type === 'existing' && assignment.existingAlbumId === album.id
                                            ? 'rgba(74,222,128,0.1)' : 'transparent',
                                        }}
                                        onClick={() => setFolderAssignment(folder, {
                                          type: 'existing',
                                          existingAlbumId: album.id,
                                          existingAlbumName: album.name,
                                        })}
                                      >
                                        <Album size={14} style={{ color: 'var(--text-muted)' }} />
                                        <span className="truncate">{album.name}</span>
                                        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>{album.mediaCount} items</span>
                                      </div>
                                    ))}
                                    {query && filtered.length < existingAlbums.length && (
                                      <div className="px-3 py-1 text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
                                        Showing {filtered.length} of {existingAlbums.length}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {folderPreview.rootFiles.length > 0 && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--card-bg)' }}>
                  <FolderOpen size={16} style={{ color: 'var(--text-muted)' }} />
                  <div className="flex-1">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Root files (no album)</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{folderPreview.rootFiles.length} file{folderPreview.rootFiles.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setFolderPreview(null)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                Cancel
              </button>
              <button
                onClick={() => handleFolderUploadConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm transition"
                style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Upload flat (no albums)
              </button>
              <button
                onClick={() => handleFolderUploadConfirm(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition"
                style={{ background: 'var(--accent)', color: '#1a1a1a' }}
              >
                Upload & assign to {folderPreview.folderGroups.size} album{folderPreview.folderGroups.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload console */}
      {totalCount > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          {/* Console header */}
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {doneCount} / {totalCount} files uploaded
              {failedCount > 0 && <span className="text-red-400 ml-2">({failedCount} failed)</span>}
            </h3>
            <div className="flex gap-2">
              {failedCount > 0 && (
                <button onClick={retryAllFailed} className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white transition flex items-center gap-1">
                  <RefreshCw size={12} /> Retry failed ({failedCount})
                </button>
              )}
              {doneCount > 0 && (
                <button onClick={clearCompleted} className="text-xs px-3 py-1 rounded transition" style={{ background: 'var(--sidebar-bg)', color: 'var(--text-muted)' }}>
                  Clear done
                </button>
              )}
            </div>
          </div>
          {/* Overall progress bar */}
          {totalCount > 0 && (
            <div className="h-1" style={{ background: 'var(--sidebar-bg)' }}>
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
              />
            </div>
          )}
          {/* Virtualized file list — only renders visible window */}
          <div className="overflow-y-auto space-y-px" style={{ maxHeight: '400px' }}>
            {visibleItems.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3 px-4 py-2" style={{ background: 'transparent' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{upload.file.name}</p>
                    {upload.folderGroup && (
                      <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(138,180,248,0.1)', color: 'var(--accent)' }}>
                        {upload.folderGroup}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--sidebar-bg)' }}>
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        upload.status === 'error' ? 'bg-red-500' :
                        upload.status === 'done' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {upload.status === 'queued' && 'Queued'}
                    {(upload.status === 'uploading' || upload.status === 'requesting') && `${upload.progress}%`}
                    {upload.status === 'completing' && 'Finalizing...'}
                    {upload.status === 'done' && <CheckCircle2 size={14} style={{ color: '#4ade80' }} />}
                    {upload.status === 'error' && <XCircle size={14} style={{ color: '#f87171' }} />}
                  </span>
                  {upload.status === 'error' && (
                    <button
                      onClick={() => retryUpload(upload.id)}
                      className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white transition"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Pagination for large uploads */}
          {totalCount > VISIBLE_LIMIT && (
            <div className="flex items-center justify-between px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <span>Showing {visibleOffset + 1}–{Math.min(visibleOffset + VISIBLE_LIMIT, totalCount)} of {totalCount}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setVisibleOffset(Math.max(0, visibleOffset - VISIBLE_LIMIT))}
                  disabled={visibleOffset === 0}
                  className="px-2 py-1 rounded transition disabled:opacity-30"
                  style={{ background: 'var(--sidebar-bg)' }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setVisibleOffset(Math.min(totalCount - 1, visibleOffset + VISIBLE_LIMIT))}
                  disabled={visibleOffset + VISIBLE_LIMIT >= totalCount}
                  className="px-2 py-1 rounded transition disabled:opacity-30"
                  style={{ background: 'var(--sidebar-bg)' }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
