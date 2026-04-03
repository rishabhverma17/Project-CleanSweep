import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { useUpload, groupFilesByFolder } from '../../hooks/useUpload';
import { albumApi } from '../../api/albumApi';
import { useTrackedTask } from '../../hooks/useTrackedTask';
import { FolderOpen, FolderUp, RefreshCw, CheckCircle2, XCircle, Album, ArrowRight } from 'lucide-react';

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
}

interface Props {
  onComplete?: () => void;
}

export function MediaUploader({ onComplete }: Props) {
  const queryClient = useQueryClient();
  const { uploads, startUpload, retryUpload, retryAllFailed, clearCompleted } = useUpload(onComplete);
  const { runTask } = useTrackedTask();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderPreview, setFolderPreview] = useState<FolderPreview | null>(null);

  const doneCount = uploads.filter(u => u.status === 'done').length;
  const failedCount = uploads.filter(u => u.status === 'error').length;

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const supported = filterSupportedFiles(acceptedFiles);
    if (supported.length > 0) startUpload(supported);
  }, [startUpload]);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const supported = filterSupportedFiles(files);
    if (supported.length === 0) return;

    const folderGroups = groupFilesByFolder(supported);
    const rootFiles = folderGroups.get('__root__') || [];
    folderGroups.delete('__root__');

    // If there are subfolders, show the preview modal
    if (folderGroups.size > 0) {
      setFolderPreview({ files: supported, folderGroups, rootFiles });
    } else {
      // No subfolders — just upload flat
      startUpload(supported);
    }

    if (folderInputRef.current) folderInputRef.current.value = '';
  }, [startUpload]);

  const handleFolderUploadConfirm = async (createAlbums: boolean) => {
    if (!folderPreview) return;
    const { files, folderGroups } = folderPreview;
    setFolderPreview(null);

    if (!createAlbums) {
      // Upload flat — no albums
      startUpload(files);
      return;
    }

    // Upload all files, then create albums from folder structure
    const folderMediaMap = await startUpload(files, folderGroups);

    // Create albums for each folder group
    if (folderMediaMap.size > 0) {
      await runTask(`Creating ${folderMediaMap.size} album(s) from folders`, async () => {
        for (const [folderName, mediaIds] of folderMediaMap) {
          if (mediaIds.length === 0) continue;
          try {
            const album = await albumApi.create(folderName);
            await albumApi.addMedia(album.id, mediaIds);
          } catch (err) {
            console.error(`Failed to create album "${folderName}":`, err);
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
              {[...folderPreview.folderGroups.entries()].map(([folder, files]) => (
                <div key={folder} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--card-bg)' }}>
                  <Album size={16} style={{ color: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{folder}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{files.length} file{files.length !== 1 ? 's' : ''}</p>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(138,180,248,0.15)', color: 'var(--accent)' }}>
                    New Album
                  </span>
                </div>
              ))}

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
                Upload & create {folderPreview.folderGroups.size} album{folderPreview.folderGroups.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-400">
              {doneCount} / {uploads.length} files uploaded
              {failedCount > 0 && <span className="text-red-400 ml-2">({failedCount} failed)</span>}
            </h3>
            <div className="flex gap-2">
              {failedCount > 0 && (
                <button onClick={retryAllFailed} className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white transition flex items-center gap-1">
                  <RefreshCw size={12} /> Retry failed ({failedCount})
                </button>
              )}
              {doneCount > 0 && (
                <button onClick={clearCompleted} className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition">
                  Clear done
                </button>
              )}
            </div>
          </div>
          {uploads.map((upload, i) => (
            <div key={i} className="flex items-center gap-3 bg-zinc-900 rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-white truncate">{upload.file.name}</p>
                  {upload.folderGroup && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(138,180,248,0.1)', color: 'var(--accent)' }}>
                      {upload.folderGroup}
                    </span>
                  )}
                </div>
                <div className="mt-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
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
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  {upload.status === 'queued' && 'Queued'}
                  {upload.status === 'uploading' && `${upload.progress}%`}
                  {upload.status === 'completing' && 'Finalizing...'}
                  {upload.status === 'done' && <CheckCircle2 size={14} style={{ color: '#4ade80' }} />}
                  {upload.status === 'error' && <XCircle size={14} style={{ color: '#f87171' }} />}
                </span>
                {upload.status === 'error' && (
                  <button
                    onClick={() => retryUpload(i)}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white transition"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
