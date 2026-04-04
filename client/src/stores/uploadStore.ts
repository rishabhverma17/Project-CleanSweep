import { create } from 'zustand';
import { mediaApi } from '../api/mediaApi';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  mediaId?: string;
  error?: string;
  folderGroup?: string;
}

interface FolderAlbumAssignment {
  type: 'new' | 'existing';
  existingAlbumId?: string;
  existingAlbumName?: string;
}

interface UploadBatch {
  id: string;
  totalFiles: number;
  folderGroups?: Map<string, File[]>;
  folderAssignments?: Map<string, FolderAlbumAssignment>;
  resolve?: (folderMediaMap: Map<string, string[]>) => void;
}

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

interface UploadStore {
  uploads: UploadItem[];
  batches: UploadBatch[];
  isUploading: boolean;

  startUpload: (
    files: File[],
    folderGroups?: Map<string, File[]>,
    folderAssignments?: Map<string, FolderAlbumAssignment>,
    onComplete?: () => void
  ) => Promise<Map<string, string[]>>;
  retryUpload: (uploadId: string) => void;
  retryAllFailed: () => void;
  clearCompleted: () => void;
  clearAll: () => void;

  // Internal
  _processQueue: () => void;
  _activeCount: number;
  _onCompleteCallbacks: Map<string, () => void>;
}

export const useUploadStore = create<UploadStore>((set, get) => {
  const updateUpload = (id: string, update: Partial<UploadItem>) => {
    set(state => ({
      uploads: state.uploads.map(u => u.id === id ? { ...u, ...update } : u),
    }));
  };

  const uploadToBlob = async (sasUrl: string, file: File, uploadId: string, attempt = 0): Promise<void> => {
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateUpload(uploadId, { progress: Math.round((e.loaded / e.total) * 100) });
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
        return uploadToBlob(sasUrl, file, uploadId, attempt + 1);
      }
      throw err;
    }
  };

  const uploadFile = async (item: UploadItem, attempt = 0) => {
    try {
      updateUpload(item.id, { status: 'uploading', progress: 0 });

      const { mediaId, uploadUrl } = await mediaApi.requestUpload(
        item.file.name, item.file.type, item.file.size
      );
      updateUpload(item.id, { mediaId });

      await uploadToBlob(uploadUrl, item.file, item.id);

      updateUpload(item.id, { status: 'completing', progress: 100 });
      await mediaApi.completeUpload(mediaId);

      updateUpload(item.id, { status: 'done', mediaId });
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
        updateUpload(item.id, { status: 'uploading', progress: 0, error: `Retry ${attempt + 1}/${MAX_RETRIES}...` });
        await new Promise(r => setTimeout(r, delay));
        return uploadFile(item, attempt + 1);
      }
      updateUpload(item.id, { status: 'error', error: err.message || 'Upload failed' });
    }
  };

  const checkBatchComplete = (batchId: string) => {
    const state = get();
    const batch = state.batches.find(b => b.id === batchId);
    if (!batch) return;

    const batchUploads = state.uploads.filter(u =>
      batch.folderGroups
        ? [...batch.folderGroups.values()].some(files => files.some(f => f === u.file))
        : false
    );

    // Check if all uploads in batch are done or errored
    const allFinished = batchUploads.length > 0 && batchUploads.every(u => u.status === 'done' || u.status === 'error');
    if (!allFinished) return;

    // Build folder → mediaIds map
    const folderMediaMap = new Map<string, string[]>();
    if (batch.folderGroups) {
      for (const [folder, files] of batch.folderGroups) {
        const mediaIds: string[] = [];
        for (const file of files) {
          const upload = state.uploads.find(u => u.file === file && u.status === 'done' && u.mediaId);
          if (upload?.mediaId) mediaIds.push(upload.mediaId);
        }
        if (mediaIds.length > 0) folderMediaMap.set(folder, mediaIds);
      }
    }

    // Call onComplete callback
    const callback = state._onCompleteCallbacks.get(batchId);
    if (callback) {
      callback();
      state._onCompleteCallbacks.delete(batchId);
    }

    batch.resolve?.(folderMediaMap);

    // Remove batch
    set(state => ({
      batches: state.batches.filter(b => b.id !== batchId),
    }));
  };

  return {
    uploads: [],
    batches: [],
    isUploading: false,
    _activeCount: 0,
    _onCompleteCallbacks: new Map(),

    startUpload: (files, folderGroups, folderAssignments, onComplete) => {
      const batchId = crypto.randomUUID();

      // Build file → folder lookup
      const fileFolderLookup = new Map<File, string>();
      if (folderGroups) {
        for (const [folder, groupFiles] of folderGroups) {
          for (const f of groupFiles) fileFolderLookup.set(f, folder);
        }
      }

      const items: UploadItem[] = files.map(file => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'queued' as const,
        folderGroup: fileFolderLookup.get(file),
      }));

      return new Promise<Map<string, string[]>>((resolve) => {
        const batch: UploadBatch = {
          id: batchId,
          totalFiles: files.length,
          folderGroups,
          folderAssignments,
          resolve,
        };

        if (onComplete) {
          get()._onCompleteCallbacks.set(batchId, onComplete);
        }

        set(state => ({
          uploads: [...state.uploads, ...items],
          batches: [...state.batches, batch],
          isUploading: true,
        }));

        // Start processing
        get()._processQueue();
      });
    },

    _processQueue: () => {
      const state = get();
      const queued = state.uploads.filter(u => u.status === 'queued');
      let active = state.uploads.filter(u => u.status === 'uploading' || u.status === 'completing').length;

      for (const item of queued) {
        if (active >= MAX_CONCURRENT) break;
        active++;

        uploadFile(item).then(() => {
          // After each upload completes, process more and check batches
          get()._processQueue();
          for (const batch of get().batches) {
            checkBatchComplete(batch.id);
          }

          // Check if all uploads are done
          const current = get();
          const stillActive = current.uploads.some(u => u.status === 'queued' || u.status === 'uploading' || u.status === 'completing');
          if (!stillActive) {
            set({ isUploading: false });
          }
        });
      }
    },

    retryUpload: (uploadId) => {
      const item = get().uploads.find(u => u.id === uploadId);
      if (!item || item.status !== 'error') return;
      updateUpload(uploadId, { status: 'queued', progress: 0, error: undefined });
      set({ isUploading: true });
      get()._processQueue();
    },

    retryAllFailed: () => {
      const state = get();
      const failed = state.uploads.filter(u => u.status === 'error');
      for (const item of failed) {
        updateUpload(item.id, { status: 'queued', progress: 0, error: undefined });
      }
      if (failed.length > 0) {
        set({ isUploading: true });
        get()._processQueue();
      }
    },

    clearCompleted: () => {
      set(state => ({
        uploads: state.uploads.filter(u => u.status !== 'done'),
      }));
    },

    clearAll: () => {
      set({ uploads: [], batches: [], isUploading: false });
    },
  };
});
