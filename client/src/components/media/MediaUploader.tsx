import { useCallback, useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { groupFilesByFolder, getTopLevelFolderName } from '../../hooks/useUpload';
import { useUploadStore } from '../../stores/uploadStore';
import { albumApi } from '../../api/albumApi';
import { FolderOpen, FolderUp, RefreshCw, Album, ArrowRight, ChevronDown, Search } from 'lucide-react';
import type { Album as AlbumType } from '../../types/media';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.mov', '.m4v']);

function filterSupportedFiles(files: File[]): File[] {
  return files.filter(f => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    // Check extension only — browser MIME can be empty for folder uploads
    return SUPPORTED_EXTENSIONS.has(ext);
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
  const { summary, startUpload, retryAllFailed, clearCompleted } = useUploadStore();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderPreview, setFolderPreview] = useState<FolderPreview | null>(null);
  const [existingAlbums, setExistingAlbums] = useState<AlbumType[]>([]);
  const [folderAssignments, setFolderAssignments] = useState<Map<string, FolderAlbumAssignment>>(new Map());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [albumSearch, setAlbumSearch] = useState('');

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
    const currentAssignments = new Map(folderAssignments);
    setFolderPreview(null);

    if (!createAlbums) {
      startUpload(files, undefined, undefined, onComplete);
      return;
    }

    // Pre-create albums BEFORE upload starts so we have album IDs ready
    const folderAlbumIds = new Map<string, string>(); // folderName → albumId
    for (const folderName of folderGroups.keys()) {
      const assignment = currentAssignments.get(folderName);
      try {
        if (assignment?.type === 'existing' && assignment.existingAlbumId) {
          folderAlbumIds.set(folderName, assignment.existingAlbumId);
        } else {
          const album = await albumApi.create(folderName);
          folderAlbumIds.set(folderName, album.id);
        }
      } catch (err) {
        console.error(`Failed to create/resolve album "${folderName}":`, err);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['albums'] });

    // Create a callback that adds each completed file to its album immediately
    const addedToAlbum = new Set<string>();
    const onFileComplete = (mediaId: string, folderGroup?: string) => {
      if (!folderGroup || addedToAlbum.has(mediaId)) return;
      const albumId = folderAlbumIds.get(folderGroup);
      if (!albumId) return;
      addedToAlbum.add(mediaId);
      // Fire-and-forget album assignment per file
      albumApi.addMedia(albumId, [mediaId]).catch(err =>
        console.error(`Failed to add ${mediaId} to album:`, err)
      );
    };

    // Start upload with per-file callback
    startUpload(files, folderGroups, undefined, () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      queryClient.invalidateQueries({ queryKey: ['album'] });
      onComplete?.();
    }, onFileComplete);
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

      {/* Upload Status Card */}
      {totalCount > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: `1px solid ${summary.uploading > 0 ? 'var(--accent)' : 'var(--border)'}` }}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                Upload Status
                {summary.uploading > 0 && (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                  </span>
                )}
              </h3>
              <div className="flex gap-2">
                {failedCount > 0 && (
                  <button onClick={retryAllFailed} className="text-xs px-3 py-1 rounded transition flex items-center gap-1" style={{ background: 'rgba(138,180,248,0.1)', color: 'var(--accent)' }}>
                    <RefreshCw size={12} /> Retry {failedCount}
                  </button>
                )}
                {doneCount > 0 && summary.uploading === 0 && summary.queued === 0 && (
                  <button onClick={clearCompleted} className="text-xs px-3 py-1 rounded transition" style={{ color: 'var(--text-muted)' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <span>{doneCount} / {totalCount} uploaded</span>
                <span>{totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`,
                    background: failedCount > 0 && summary.uploading === 0 ? '#f87171' : 'var(--accent)',
                  }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Queued</p>
                <p className="text-xl font-bold" style={{ color: summary.queued > 0 ? 'var(--accent)' : 'var(--text-primary)' }}>{summary.queued.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Uploading</p>
                <p className="text-xl font-bold" style={{ color: summary.uploading > 0 ? '#fbbf24' : 'var(--text-primary)' }}>{summary.uploading}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Complete</p>
                <p className="text-xl font-bold" style={{ color: doneCount > 0 ? '#4ade80' : 'var(--text-primary)' }}>{doneCount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Failed</p>
                <p className="text-xl font-bold" style={{ color: failedCount > 0 ? '#f87171' : 'var(--text-primary)' }}>{failedCount}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
