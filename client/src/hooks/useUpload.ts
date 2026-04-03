import { useState, useCallback, useRef } from 'react';
import { mediaApi } from '../api/mediaApi';

interface UploadItem {
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  mediaId?: string;
  error?: string;
  folderGroup?: string; // which album/folder this file belongs to
}

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

/**
 * Parse folder structure from webkitRelativePath.
 * Input: "Photos/Beach Trip/IMG_001.jpg"
 * Returns: "Beach Trip" (skips top-level selected folder)
 * Input: "Photos/IMG_002.jpg" → null (root level, no subfolder)
 * Input: "Photos/Summer/Beach/IMG.jpg" → "Summer/Beach" (preserves nesting)
 */
export function parseFolderGroup(file: File): string | null {
  const path = (file as any).webkitRelativePath as string | undefined;
  if (!path) return null;
  
  const parts = path.split('/');
  // parts[0] = top-level folder (the one user selected), parts[-1] = filename
  if (parts.length <= 2) return null; // file directly in selected folder, no subfolder
  
  // Everything between top-level folder and filename = subfolder path
  const subfolders = parts.slice(1, -1).join('/');
  return subfolders || null;
}

/**
 * Group files by their folder structure.
 * Returns: Map of folderName → File[]
 * Files with no subfolder go to the "__root__" group.
 */
export function groupFilesByFolder(files: File[]): Map<string, File[]> {
  const groups = new Map<string, File[]>();
  for (const file of files) {
    const folder = parseFolderGroup(file) ?? '__root__';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(file);
  }
  return groups;
}

export function useUpload(onComplete?: () => void) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const completedMediaIdsRef = useRef<Map<number, string>>(new Map()); // index → mediaId

  const updateUpload = (index: number, update: Partial<UploadItem>) => {
    setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...update } : u));
  };

  const uploadFile = async (file: File, index: number, attempt = 0) => {
    try {
      updateUpload(index, { status: 'uploading', progress: 0 });

      // Step 1: Request SAS URL
      const { mediaId, uploadUrl } = await mediaApi.requestUpload(
        file.name, file.type, file.size
      );
      updateUpload(index, { mediaId });

      // Step 2: Upload directly to blob via SAS URL
      await uploadToBlob(uploadUrl, file, index);

      // Step 3: Notify API
      updateUpload(index, { status: 'completing', progress: 100 });
      await mediaApi.completeUpload(mediaId);

      updateUpload(index, { status: 'done' });
      // Track completed mediaId for album assignment
      if (mediaId) completedMediaIdsRef.current.set(index, mediaId);
    } catch (err: any) {
      // Auto-retry up to MAX_RETRIES before showing error
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
        updateUpload(index, { status: 'uploading', progress: 0, error: `Retry ${attempt + 1}/${MAX_RETRIES}...` });
        await new Promise(r => setTimeout(r, delay));
        return uploadFile(file, index, attempt + 1);
      }
      updateUpload(index, { status: 'error', error: err.message || 'Upload failed' });
    }
  };

  const uploadToBlob = async (sasUrl: string, file: File, index: number, attempt = 0): Promise<void> => {
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateUpload(index, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        };

        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
      });
    } catch (err: any) {
      const status = parseInt(err.message?.replace('HTTP ', ''));
      if ((status === 429 || status === 503 || isNaN(status)) && attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
        const jitter = delay * (0.75 + Math.random() * 0.5);
        await new Promise(r => setTimeout(r, jitter));
        return uploadToBlob(sasUrl, file, index, attempt + 1);
      }
      throw err;
    }
  };

  const startUpload = useCallback((files: File[], folderGroups?: Map<string, File[]>): Promise<Map<string, string[]>> => {
    completedMediaIdsRef.current = new Map();
    
    const items: UploadItem[] = files.map(file => ({
      file,
      progress: 0,
      status: 'queued',
      folderGroup: folderGroups ? (parseFolderGroup(file) ?? undefined) : undefined,
    }));
    setUploads(items);

    return new Promise((resolve) => {
      let active = 0;
      let nextIndex = 0;

      const processNext = () => {
        while (active < MAX_CONCURRENT && nextIndex < items.length) {
          const idx = nextIndex++;
          active++;
          uploadFile(files[idx], idx).finally(() => {
            active--;
            processNext();
            if (active === 0 && nextIndex >= items.length) {
              // All uploads done — build folder → mediaIds map
              const folderMediaMap = new Map<string, string[]>();
              if (folderGroups) {
                items.forEach((item, i) => {
                  const mediaId = completedMediaIdsRef.current.get(i);
                  if (mediaId && item.folderGroup) {
                    if (!folderMediaMap.has(item.folderGroup)) folderMediaMap.set(item.folderGroup, []);
                    folderMediaMap.get(item.folderGroup)!.push(mediaId);
                  }
                });
              }
              onComplete?.();
              resolve(folderMediaMap);
            }
          });
        }
      };

      processNext();
    });
  }, []);

  const retryUpload = useCallback((index: number) => {
    const item = uploads[index];
    if (!item || item.status !== 'error') return;
    uploadFile(item.file, index).then(() => onComplete?.());
  }, [uploads]);

  const retryAllFailed = useCallback(() => {
    uploads.forEach((item, index) => {
      if (item.status === 'error') {
        uploadFile(item.file, index);
      }
    });
  }, [uploads]);

  const clearCompleted = useCallback(() => {
    setUploads(prev => prev.filter(u => u.status !== 'done'));
  }, []);

  return { uploads, startUpload, retryUpload, retryAllFailed, clearCompleted };
}
